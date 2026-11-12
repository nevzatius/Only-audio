// Twitch adaptörü (MAIN world, document_start). Sözleşme: docs/plan-faz1.md.
// usher'a allow_audio_only=true eklemesi DNR kuralının işi (rules/twitch.json);
// burada oynatıcı örneği bulunur ve kalite audio_only'ye çekilir.
(() => {
  'use strict';

  const FROM_MAIN = 'only-audio/main';
  const TO_MAIN = 'only-audio/ext';
  const BYPASS_KEY = 'onlyaudio:tw:bypass';
  const TICK_MS = 2000;
  const STALL_MS = 5000; // her kurtarma adımı arasındaki bekleme
  const MIN_SET_GAP_MS = 3000; // iki setQuality arasındaki en kısa süre
  const WARMUP_MS = 20000;
  const MIN_PLAY_SEC = 5; // geçişten önce içeriğin en az bu kadar oynamış olması
  const MAX_UP_STEPS = 80;

  let restored = false;
  let status = { mode: 'pending', reason: 'init' };
  let lastPlayer = null;
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

  function playerSelector() {
    return document.querySelector('.video-player__container') ? '.video-player__container' : '.video-player';
  }

  function post(extra) {
    window.postMessage(
      Object.assign(
        { source: FROM_MAIN, type: 'status', site: 'twitch', playerSelector: playerSelector() },
        extra,
      ),
      '*',
    );
  }

  function setStatus(mode, reason) {
    status = { mode, reason };
    post(status);
  }

  function isPlayer(o) {
    return !!o && typeof o === 'object' && typeof o.getQualities === 'function' && typeof o.setQuality === 'function';
  }

  function fiberOf(el) {
    for (const k in el) {
      if (k.startsWith('__reactFiber$')) return el[k];
    }
    return null;
  }

  // .video-player fiber'ından yukarı doğru yapısal arama; sabit derinlik yok.
  function findPlayer() {
    const root = document.querySelector('.video-player');
    if (!root) return null;
    let f = fiberOf(root);
    for (let i = 0; f && i < MAX_UP_STEPS; i++, f = f.return) {
      const props = f.memoizedProps;
      if (props && typeof props === 'object') {
        if (isPlayer(props.mediaPlayerInstance)) return props.mediaPlayerInstance;
        for (const k in props) {
          let v;
          try {
            v = props[k];
          } catch (_e) {
            continue;
          }
          if (isPlayer(v)) return v;
        }
      }
      if (isPlayer(f.stateNode)) return f.stateNode;
    }
    return null;
  }

  function videoEl() {
    return document.querySelector('.video-player video') || document.querySelector('video');
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
  function checkVerify(player, list, target) {
    const v = videoEl();
    if (!verify || !v || verify.done) return;
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
    const player = findPlayer();
    if (!player) {
      if (status.mode !== 'pending') setStatus('pending', 'no-player');
      return;
    }
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
      if (status.mode !== 'pending') setStatus('pending', 'no-qualities'); // reklam/preroll
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

    const v = videoEl();
    if (!currentIs(player, target)) {
      // Oynatma başlamadan geçiş bazı kanallarda Hata #4000 ile oynatıcıyı öldürüyor:
      // varsayılan kalitede oynatma başlayana dek (en çok WARMUP_MS) bekle.
      if (playing(player, v)) {
        // Oynatma başlar başlamaz (ct < 1 sn) geçiş oynatıcıyı sessizce öldürüyor
        // (readyState 0, paused). İçerik kısa süre oynamadan dokunma.
        if (!v || v.currentTime < MIN_PLAY_SEC) return;
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
    checkVerify(player, list, target);
  }

  function restore() {
    if (restored) return;
    restored = true;
    try {
      sessionStorage.setItem(BYPASS_KEY, '1');
    } catch (_e) {}
    try {
      const p = lastPlayer || findPlayer();
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
