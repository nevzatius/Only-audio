// Kick adaptörü (MAIN world, document_start). Sözleşme: docs/plan-faz2b.md.
// IVS playback isteğine allow_audio_only=true eklemesi DNR kuralının işi (rules/kick.json);
// burada IVS oynatıcı örneği bulunur ve kalite audio_only'ye çekilir.
(() => {
  'use strict';

  const FROM_MAIN = 'only-audio/main';
  const TO_MAIN = 'only-audio/ext';
  const BYPASS_KEY = 'onlyaudio:kick:bypass';
  const CONTAINER_ATTR = 'data-only-audio-player';
  const PLAYER_SELECTOR = '[' + CONTAINER_ATTR + ']';
  const TICK_MS = 2000;
  const STALL_MS = 5000; // her kurtarma adımı arasındaki bekleme
  const MIN_SET_GAP_MS = 3000; // iki setQuality arasındaki en kısa süre
  const WARMUP_MS = 20000;
  const MIN_PLAY_SEC = 5; // geçişten önce içeriğin en az bu kadar oynamış olması
  const MAX_FIBERS = 20000; // ağaç taraması üst sınırı
  const MAX_HOOKS = 200;
  const RESCAN_TICKS = 5; // önbellekteki örnek bu kadar turda bir yeniden doğrulanır

  let restored = false;
  let status = { mode: 'pending', reason: 'init' };
  let lastPlayer = null;
  let cachedPlayer = null;
  let cachedFor = null; // önbelleğin ait olduğu <video>
  let ticksSinceScan = 0;
  let lastSetAt = 0;
  let pinnedLowest = false; // kurtarma sonrası en düşük video kalitesine sabitlendi
  let firstSeenAt = 0;
  let verify = null; // { lastCT, lastProgressAt, step, done }

  function bypassed() {
    try {
      return sessionStorage.getItem(BYPASS_KEY) === '1';
    } catch (_e) {
      return false;
    }
  }

  function post(extra) {
    window.postMessage(
      Object.assign({ source: FROM_MAIN, type: 'status', site: 'kick', playerSelector: PLAYER_SELECTOR }, extra),
      '*',
    );
  }

  function setStatus(mode, reason) {
    status = { mode, reason };
    post(status);
  }

  function videoEl() {
    return document.querySelector('video#video-player');
  }

  // Kick'te kararlı kapsayıcı seçicisi yok: videonun ebeveyni işaretlenir.
  function markContainer(v) {
    const parent = v && v.parentElement;
    if (!parent || parent.hasAttribute(CONTAINER_ATTR)) return;
    for (const el of document.querySelectorAll(PLAYER_SELECTOR)) el.removeAttribute(CONTAINER_ATTR);
    parent.setAttribute(CONTAINER_ATTR, '');
  }

  function isPlayer(o) {
    try {
      return (
        !!o &&
        typeof o === 'object' &&
        typeof o.getQualities === 'function' &&
        typeof o.setQuality === 'function' &&
        typeof o.setAutoQualityMode === 'function'
      );
    } catch (_e) {
      return false;
    }
  }

  function get(o, k) {
    try {
      return o[k];
    } catch (_e) {
      return undefined;
    }
  }

  // Bir değerin kendisi ya da ref/sarmalayıcı içi (.current, .value, .current.value) oynatıcı mı?
  function probe(v) {
    if (!v || typeof v !== 'object') return null;
    if (isPlayer(v)) return v;
    const cur = get(v, 'current');
    if (isPlayer(cur)) return cur;
    const val = get(v, 'value');
    if (isPlayer(val)) return val;
    if (cur && typeof cur === 'object') {
      const cv = get(cur, 'value');
      if (isPlayer(cv)) return cv;
    }
    return null;
  }

  function probeFiber(f, out) {
    const props = f.memoizedProps;
    if (props && typeof props === 'object') {
      for (const k in props) {
        const p = probe(get(props, k));
        if (p) out.add(p);
      }
    }
    const sn = probe(f.stateNode);
    if (sn) out.add(sn);
    // Fonksiyon bileşeni: hook bağlı listesi. Sınıf bileşeni: düz durum nesnesi.
    let h = f.memoizedState;
    if (h && typeof h === 'object' && 'next' in h && 'memoizedState' in h) {
      for (let i = 0; h && i < MAX_HOOKS; i++, h = h.next) {
        const p = probe(h.memoizedState);
        if (p) out.add(p);
      }
    } else if (h && typeof h === 'object') {
      const direct = probe(h);
      if (direct) out.add(direct);
      for (const k in h) {
        const p = probe(get(h, k));
        if (p) out.add(p);
      }
    }
  }

  function fiberOf(el) {
    for (const k in el) {
      if (k.startsWith('__reactFiber$')) return el[k];
    }
    return null;
  }

  // Video fiber'ından köke çık, tüm ağacı yapısal olarak tara; sabit yol yok.
  function scanForPlayer(v) {
    let root = fiberOf(v);
    if (!root) return null;
    while (root.return) root = root.return;
    const found = new Set();
    const stack = [root];
    let n = 0;
    while (stack.length && n < MAX_FIBERS) {
      const f = stack.pop();
      n++;
      try {
        probeFiber(f, found);
      } catch (_e) {}
      if (f.sibling) stack.push(f.sibling);
      if (f.child) stack.push(f.child);
    }
    let first = null;
    for (const p of found) {
      if (!first) first = p;
      try {
        if (typeof p.getHTMLVideoElement === 'function' && p.getHTMLVideoElement() === v) return p;
      } catch (_e) {}
    }
    return first;
  }

  function findPlayer(v) {
    ticksSinceScan++;
    if (cachedPlayer && cachedFor === v && ticksSinceScan < RESCAN_TICKS) return cachedPlayer;
    ticksSinceScan = 0;
    cachedPlayer = scanForPlayer(v);
    cachedFor = v;
    return cachedPlayer;
  }

  function qKey(q) {
    if (!q) return '';
    if (typeof q === 'string') return q;
    return String(q.group || q.name || '');
  }

  function isAudio(q) {
    return !!q && typeof q === 'object' && (q.group === 'audio_only' || /audio/i.test(String(q.group || q.name || '')));
  }

  function lowestVideo(list) {
    let best = null;
    for (const q of list) {
      if (!q || isAudio(q)) continue;
      const b = typeof q.bitrate === 'number' ? q.bitrate : Infinity;
      if (!best || b < (typeof best.bitrate === 'number' ? best.bitrate : Infinity)) best = q;
    }
    return best;
  }

  function applyQuality(player, q) {
    lastSetAt = Date.now();
    try {
      player.setAutoQualityMode(false);
    } catch (_e) {}
    try {
      player.setQuality(q);
    } catch (_e) {}
  }

  function currentIs(player, q) {
    let cur = null;
    try {
      cur = typeof player.getQuality === 'function' ? player.getQuality() : null;
    } catch (_e) {}
    return !!cur && qKey(cur) === qKey(q);
  }

  function playing(player, v) {
    let st = '';
    try {
      st = typeof player.getState === 'function' ? String(player.getState()) : '';
    } catch (_e) {}
    return st === 'Playing' || (!!v && v.readyState >= 2 && v.currentTime > 0);
  }

  function startVerify(v) {
    verify = { lastCT: v ? v.currentTime : 0, lastProgressAt: Date.now(), step: 0, done: false };
  }

  // Geçişten sonra oynatma ilerlemiyorsa: play() → setQuality yinele → en düşük video.
  function checkVerify(player, list, target, v) {
    if (!verify || verify.done) return;
    const now = Date.now();
    if (v.currentTime > verify.lastCT + 0.05) {
      verify.lastCT = v.currentTime;
      verify.lastProgressAt = now;
      verify.done = true;
      return;
    }
    if (now - verify.lastProgressAt < STALL_MS) return;
    verify.lastProgressAt = now;
    verify.step++;
    if (verify.step === 1) {
      try {
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } catch (_e) {}
    } else if (verify.step === 2) {
      applyQuality(player, target);
    } else if (verify.step === 3) {
      const low = lowestVideo(list);
      if (low) {
        pinnedLowest = true;
        applyQuality(player, low);
        setStatus('fallback', 'stalled');
      }
      verify.done = true;
    }
  }

  function tick() {
    if (restored) return;
    const v = videoEl();
    const player = v ? findPlayer(v) : null;
    if (!v || !player) {
      if (status.mode !== 'pending') setStatus('pending', 'no-player');
      return;
    }
    markContainer(v);
    if (player !== lastPlayer) {
      lastPlayer = player;
      firstSeenAt = Date.now();
      pinnedLowest = false;
      verify = null;
    }
    let list = [];
    try {
      list = player.getQualities() || [];
    } catch (_e) {}
    if (!Array.isArray(list) || list.length === 0) {
      if (status.mode !== 'pending') setStatus('pending', 'no-qualities');
      return;
    }

    const audio = list.find(isAudio) || null;
    let target;
    let mode;
    let reason;
    if (pinnedLowest) {
      target = lowestVideo(list);
      mode = 'fallback';
      reason = 'stalled';
    } else if (audio) {
      target = audio;
      mode = 'audio';
      reason = 'dnr';
    } else {
      target = lowestVideo(list);
      mode = 'fallback';
      reason = 'no-audio-variant';
    }
    if (!target) return;

    if (!currentIs(player, target)) {
      // Twitch'teki gibi: oynatma başlamadan ya da başlar başlamaz (ct < MIN_PLAY_SEC)
      // kalite değiştirme; Twitch'te erken geçiş oynatıcıyı öldürdü (docs/known-issues.md).
      if (playing(player, v)) {
        if (v.currentTime < MIN_PLAY_SEC) return;
      } else if (Date.now() - firstSeenAt < WARMUP_MS) {
        return;
      }
      if (Date.now() - lastSetAt >= MIN_SET_GAP_MS) {
        applyQuality(player, target);
        startVerify(v);
      }
      return; // sonuç bir sonraki turda doğrulanır
    }
    if (status.mode !== mode || status.reason !== reason) setStatus(mode, reason);
    if (!verify) startVerify(v);
    checkVerify(player, list, target, v);
  }

  function restore() {
    if (restored) return;
    restored = true;
    try {
      sessionStorage.setItem(BYPASS_KEY, '1');
    } catch (_e) {}
    try {
      const v = videoEl();
      const p = lastPlayer || (v ? scanForPlayer(v) : null);
      if (p && typeof p.setAutoQualityMode === 'function') p.setAutoQualityMode(true);
    } catch (_e) {}
    setStatus('off', 'user-restore');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== TO_MAIN) return;
    if (d.type === 'hello') post(status);
    else if (d.type === 'restore') restore();
  });

  if (bypassed()) {
    restored = true;
    setStatus('off', 'user-restore');
    return;
  }

  setInterval(tick, TICK_MS);
  post(status);
})();
