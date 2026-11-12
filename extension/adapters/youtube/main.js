// YouTube adaptörü (MAIN world, document_start). Sözleşme: docs/plan-faz1.md.
// Object.prototype.audio_only kancası oynatıcıya SABR'dan yalnız ses istetir.
// Canlı yayında kanca oynatmayı kırar: kancasız yeniden yüklenir, 144p'ye düşülür.
(() => {
  'use strict';

  const FROM_MAIN = 'only-audio/main';
  const TO_MAIN = 'only-audio/ext';
  const BYPASS_KEY = 'onlyaudio:yt:bypass';
  const PLAYER_SELECTOR = '#movie_player';
  const POLL_MS = 500;
  const VERIFY_MIN_TIME = 5; // sn: kanca doğrulaması için en az ilerleme
  const QUALITY_RETRY_MS = 3000;

  // ---- yardımcılar ---------------------------------------------------------

  // Sayfa anahtarı: /watch?v=ID için ID; kanal canlı sayfaları (/@kanal/live, /live/ID)
  // /watch'a yönlenmeden oynatıcıyı yerinde açar, bunlar için yol kullanılır.
  function videoIdNow() {
    try {
      const path = location.pathname;
      if (path === '/watch') return new URLSearchParams(location.search).get('v') || '';
      if (/\/live$/.test(path) || /^\/live\/[^/]+/.test(path)) return path;
    } catch (_e) {}
    return '';
  }

  function isWatch() {
    return videoIdNow() !== '';
  }

  function readBypass() {
    try {
      const raw = sessionStorage.getItem(BYPASS_KEY);
      if (!raw) return null;
      const b = JSON.parse(raw);
      if (b && (b.reason === 'user' || b.reason === 'live') && typeof b.videoId === 'string') return b;
    } catch (_e) {}
    return null;
  }

  function writeBypass(reason, videoId) {
    try {
      sessionStorage.setItem(BYPASS_KEY, JSON.stringify({ reason, videoId }));
    } catch (_e) {}
  }

  function clearBypass() {
    try {
      sessionStorage.removeItem(BYPASS_KEY);
    } catch (_e) {}
  }

  // ---- durum ---------------------------------------------------------------

  let mode = 'pending';
  let reason = 'init';
  let hookInstalled = false;
  let leaving = false; // sayfa yeniden yükleniyor; başka işlem yapma
  let lastKey = null;
  let lastQualityApply = 0;

  function postStatus() {
    window.postMessage(
      { source: FROM_MAIN, type: 'status', site: 'youtube', mode, reason, playerSelector: PLAYER_SELECTOR },
      '*',
    );
  }

  function setStatus(m, r) {
    if (m === mode && r === reason) return;
    mode = m;
    reason = r;
    postStatus();
  }

  function baseState() {
    if (!isWatch()) return ['pending', 'not-watch'];
    if (hookInstalled) return ['audio', 'hook'];
    const b = readBypass();
    if (b && b.reason === 'live') return ['fallback', 'live'];
    if (b && b.reason === 'user') return ['off', 'user-restore'];
    return ['off', 'no-hook'];
  }

  // ---- kanca ---------------------------------------------------------------

  function installHook() {
    try {
      Object.defineProperty(Object.prototype, 'audio_only', {
        get() {
          return '1';
        },
        set(v) {
          try {
            Object.defineProperty(this, 'audio_only', {
              value: v,
              writable: true,
              configurable: true,
              enumerable: true,
            });
          } catch (_e) {}
        },
        configurable: true,
        enumerable: false,
      });
      hookInstalled = true;
    } catch (_e) {
      hookInstalled = false;
    }
  }

  // ---- oynatıcı işlemleri --------------------------------------------------

  function applyTiny(player) {
    if (typeof player.setPlaybackQualityRange !== 'function') return;
    const now = Date.now();
    if (now - lastQualityApply < QUALITY_RETRY_MS) return;
    let q = '';
    try {
      q = typeof player.getPlaybackQuality === 'function' ? player.getPlaybackQuality() : '';
    } catch (_e) {}
    if (q === 'tiny' && lastQualityApply > 0) return;
    lastQualityApply = now;
    try {
      player.setPlaybackQualityRange('tiny', 'tiny');
    } catch (_e) {}
  }

  function verifyHook(player) {
    if (player.classList && player.classList.contains('ad-showing')) return;
    const video = player.querySelector('video');
    if (!video || video.currentTime < VERIFY_MIN_TIME) return;
    let frames = 0;
    try {
      frames = video.getVideoPlaybackQuality().totalVideoFrames;
    } catch (_e) {}
    if (video.videoWidth > 0 || frames > 0) {
      // Kanca tutmadı (parametre adı değişmiş olabilir): 144p'ye düş.
      setStatus('fallback', 'hook-failed');
      applyTiny(player);
    }
  }

  function reloadWith(reasonName, videoId) {
    leaving = true;
    writeBypass(reasonName, videoId);
    location.reload();
  }

  // ---- gezinme -------------------------------------------------------------

  function refresh() {
    const watch = isWatch();
    const vid = videoIdNow();
    const key = watch ? vid : '';
    if (key === lastKey) return;
    lastKey = key;
    lastQualityApply = 0;
    if (watch) {
      const b = readBypass();
      if (b && b.videoId !== vid) {
        clearBypass();
        if (!hookInstalled) {
          // Kanca oynatıcıdan önce kurulmalı: temiz yükleme.
          leaving = true;
          location.reload();
          return;
        }
      }
    }
    const [m, r] = baseState();
    mode = m;
    reason = r;
    postStatus();
  }

  function tick() {
    if (leaving) return;
    refresh();
    if (leaving || !isWatch()) return;
    const player = document.getElementById('movie_player');
    if (!player || typeof player.getVideoData !== 'function') return;
    let data = null;
    try {
      data = player.getVideoData();
    } catch (_e) {}
    const vid = videoIdNow();
    if (!data || !data.video_id) return;
    if (location.pathname === '/watch' && data.video_id !== vid) return;

    if (hookInstalled) {
      if (data.isLive) {
        reloadWith('live', vid);
        return;
      }
      if (mode === 'audio') verifyHook(player);
      else if (mode === 'fallback') applyTiny(player);
    } else {
      const b = readBypass();
      if (b && b.reason === 'live') applyTiny(player);
    }
  }

  function restore() {
    if (leaving) return;
    const vid = videoIdNow();
    const player = document.getElementById('movie_player');
    let t = 0;
    let live = false;
    try {
      const video = player && player.querySelector('video');
      if (video && isFinite(video.currentTime)) t = Math.floor(video.currentTime);
      const data = player && typeof player.getVideoData === 'function' ? player.getVideoData() : null;
      live = !!(data && data.isLive);
    } catch (_e) {}
    setStatus('off', 'user-restore');
    leaving = true;
    writeBypass('user', vid);
    if (!isWatch() || !vid) {
      location.reload();
      return;
    }
    try {
      const url = new URL(location.href);
      if (!live && t > 0) url.searchParams.set('t', t + 's');
      location.assign(url.toString());
    } catch (_e) {
      location.reload();
    }
  }

  // ---- başlatma ------------------------------------------------------------

  (function init() {
    const watch = isWatch();
    const vid = videoIdNow();
    const b = readBypass();
    if (watch && b && b.videoId !== vid) clearBypass();
    if (!readBypass()) installHook();
    lastKey = watch ? vid : '';
    const [m, r] = baseState();
    mode = m;
    reason = r;

    window.addEventListener('message', (event) => {
      if (event.source !== window) return;
      const d = event.data;
      if (!d || d.source !== TO_MAIN) return;
      if (d.type === 'hello') postStatus();
      else if (d.type === 'restore') restore();
    });
    window.addEventListener('yt-navigate-finish', () => refresh(), true);
    setInterval(tick, POLL_MS);
    postStatus();
  })();
})();
