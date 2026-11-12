// Genel adaptör (MAIN world, document_start). Kullanıcının çalışma anında eklediği
// sitelerde <video> için: videoyu gizler, kapak gösterir, mümkünse en düşük kaliteye çeker.
// Sözleşme: docs/plan-faz3.md. Durum iletileri diğer adaptörlerle aynıdır (site:'generic').
(() => {
  'use strict';
  if (window.__onlyAudioGeneric) return;
  window.__onlyAudioGeneric = true;

  const FROM_MAIN = 'only-audio/main';
  const TO_MAIN = 'only-audio/ext';
  const BYPASS_KEY = 'onlyaudio:generic:bypass';
  const CONTAINER_ATTR = 'data-only-audio-player';
  const PLAYER_SELECTOR = '[' + CONTAINER_ATTR + ']';
  const POS_ATTR = 'data-only-audio-pos'; // kapsayıcıya position:relative'i biz verdik
  const TICK_MS = 1000;
  const MIN_AREA = 2500; // 50x50 pikselden küçük videolar (simge, izleme önizlemesi) yok sayılır
  const MAX_WINDOW_KEYS = 3000; // hls.js örneği araması üst sınırı
  const MAX_QUALITY_TRIES = 10;

  let stopped = false;
  let status = { mode: 'pending', reason: 'init' };
  let target = null; // gizlenen <video>
  let prevVisibility = null; // { value, priority } önceki satır içi değer
  let container = null;
  let qualityTries = 0;
  let loweredBy = null; // başarıyla düşürülen oynatıcı örneği
  let timer = 0;

  function bypassed() {
    try {
      return sessionStorage.getItem(BYPASS_KEY) === '1';
    } catch (_e) {
      return false;
    }
  }

  function post(extra) {
    window.postMessage(
      Object.assign({ source: FROM_MAIN, type: 'status', site: 'generic', playerSelector: PLAYER_SELECTOR }, extra),
      '*',
    );
  }

  function setStatus(mode, reason) {
    status = { mode, reason };
    post(status);
  }

  function pickVideo() {
    let best = null;
    let bestKey = -1;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      const area = r.width * r.height;
      if (area < MIN_AREA && v !== target) continue;
      // Oynayan video her zaman büyüğe baskın; eşitlikte alan.
      const key = (v.paused ? 0 : 1e9) + area;
      if (key > bestKey) {
        best = v;
        bestKey = key;
      }
    }
    return best;
  }

  function hide(v) {
    if (v.style.visibility !== 'hidden') v.style.setProperty('visibility', 'hidden', 'important');
  }

  function unmarkContainer() {
    if (!container) return;
    container.removeAttribute(CONTAINER_ATTR);
    if (container.hasAttribute(POS_ATTR)) {
      container.style.position = '';
      container.removeAttribute(POS_ATTR);
    }
    container = null;
  }

  // Kapak absolute konumlandığından kapsayıcı konumlandırılmış olmalı.
  function markContainer(v) {
    const parent = v.parentElement;
    if (!parent || parent === document.body || parent === document.documentElement) return;
    if (container === parent) return;
    unmarkContainer();
    container = parent;
    container.setAttribute(CONTAINER_ATTR, '');
    try {
      if (window.getComputedStyle(container).position === 'static') {
        container.style.position = 'relative';
        container.setAttribute(POS_ATTR, '');
      }
    } catch (_e) {}
  }

  function release() {
    if (target) {
      if (prevVisibility && prevVisibility.value) {
        target.style.setProperty('visibility', prevVisibility.value, prevVisibility.priority);
      } else {
        target.style.removeProperty('visibility');
      }
    }
    target = null;
    prevVisibility = null;
    unmarkContainer();
  }

  function adopt(v) {
    release();
    target = v;
    prevVisibility = {
      value: v.style.getPropertyValue('visibility'),
      priority: v.style.getPropertyPriority('visibility'),
    };
    loweredBy = null;
    qualityTries = 0;
  }

  // En iyi çaba: sayfada hls.js benzeri bir örnek (levels[], currentLevel, autoLevelEnabled)
  // bulunursa en düşük bit hızına sabitlenir. Düz <video> ve MSE oynatıcılarında API yoktur.
  function findHlsLike(v) {
    let first = null;
    let n = 0;
    for (const k of Object.getOwnPropertyNames(window)) {
      if (++n > MAX_WINDOW_KEYS) break;
      try {
        const o = window[k];
        if (o && typeof o === 'object' && Array.isArray(o.levels) && o.levels.length > 0 && 'currentLevel' in o && 'autoLevelEnabled' in o) {
          if (o.media === v) return o;
          if (!first) first = o;
        }
      } catch (_e) {}
    }
    return first;
  }

  function lowestLevelIndex(levels) {
    let idx = -1;
    let bps = Infinity;
    levels.forEach((l, i) => {
      const b = l && typeof l.bitrate === 'number' ? l.bitrate : Infinity;
      if (idx < 0 || b < bps) {
        idx = i;
        bps = b;
      }
    });
    return idx;
  }

  function tryLowerQuality(v) {
    if (loweredBy || qualityTries >= MAX_QUALITY_TRIES) return;
    qualityTries++;
    const p = findHlsLike(v);
    if (!p) return;
    const idx = lowestLevelIndex(p.levels);
    if (idx < 0) return;
    try {
      p.currentLevel = idx;
      loweredBy = p;
    } catch (_e) {}
  }

  function tick() {
    if (stopped) return;
    const v = pickVideo();
    if (!v) {
      if (target) release();
      if (status.mode !== 'pending') setStatus('pending', 'no-video');
      return;
    }
    if (v !== target) adopt(v);
    hide(v);
    markContainer(v);
    tryLowerQuality(v);
    const mode = loweredBy ? 'fallback' : 'audio';
    const reason = loweredBy ? 'lowest-quality' : 'hidden';
    if (status.mode !== mode || status.reason !== reason) setStatus(mode, reason);
  }

  function stop(reason, remember) {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (remember) {
      try {
        sessionStorage.setItem(BYPASS_KEY, '1');
      } catch (_e) {}
    }
    try {
      if (loweredBy) loweredBy.currentLevel = -1; // otomatik seçime dön
    } catch (_e) {}
    release();
    setStatus('off', reason);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== TO_MAIN) return;
    if (d.type === 'hello') post(status);
    else if (d.type === 'restore') stop('user-restore', true); // "Videoya dön": bu sekme oturumunda kalıcı
    else if (d.type === 'disable') stop('disabled', false); // site kaldırıldı / uzantı kapandı
  });

  if (bypassed()) {
    stopped = true;
    setStatus('off', 'user-restore');
    return;
  }

  timer = setInterval(tick, TICK_MS);
  post(status);
})();
