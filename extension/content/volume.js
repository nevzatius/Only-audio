// Sekme ses kontrolcüsü, içerik betiği (izole dünya, document_start). Sözleşme: docs/plan-faz5.md.
// Sayfadaki tüm <video>/<audio> öğelerinin volume değerini popup'ta seçilen değere sabitler:
// sonradan eklenenleri yakalar, site değeri geri değiştirirse (SPA geçişi, oynatıcı yenilemesi) yeniden uygular.
// Değer yoksa (null) hiçbir şeye dokunmaz: sitenin kendi ses çubuğu çalışır.
(() => {
  'use strict';
  if (window.__onlyAudioVolume) return;
  window.__onlyAudioVolume = true;

  // İçerik betikleri ES modülü içe aktaramaz; shared/volume.js MSG ile aynı olmalı.
  const MSG_GET = 'oa-vol:get';
  const MSG_APPLY = 'oa-vol:apply';
  const MSG_PING = 'oa-vol:ping';
  const EPSILON = 0.001;
  const MEDIA_EVENTS = ['volumechange', 'loadedmetadata', 'loadstart', 'play', 'playing'];

  let volume = null; // 0..1 ya da null (geçersiz kılma yok)

  function applyTo(el) {
    if (volume === null) return;
    try {
      if (Math.abs(el.volume - volume) > EPSILON) el.volume = volume;
    } catch (_e) {}
  }

  function applyAll() {
    if (volume === null) return;
    for (const el of document.querySelectorAll('video, audio')) applyTo(el);
  }

  function setVolume(next) {
    volume = typeof next === 'number' && next >= 0 && next < 1 ? next : null;
    applyAll();
  }

  // Medya olayları kabarmaz ama yakalama aşamasında document'ta görülür. volumechange'de yalnız
  // fark varsa yazılır; kendi yazdığımızın tetiklediği olayda fark kalmadığından döngü olmaz.
  for (const type of MEDIA_EVENTS) {
    document.addEventListener(
      type,
      (e) => {
        const t = e.target;
        if (t && (t.tagName === 'VIDEO' || t.tagName === 'AUDIO')) applyTo(t);
      },
      true,
    );
  }

  const observer = new MutationObserver((records) => {
    if (volume === null) return;
    for (const r of records) {
      for (const node of r.addedNodes) {
        if (node.nodeType !== 1) continue;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') applyTo(node);
        else if (node.querySelectorAll) for (const el of node.querySelectorAll('video, audio')) applyTo(el);
      }
    }
  });
  observer.observe(document, { childList: true, subtree: true });

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === MSG_APPLY) {
        setVolume(msg.volume);
        sendResponse({ ok: true });
      } else if (msg.type === MSG_PING) {
        sendResponse({ ok: true, volume });
      }
      return false;
    });
    chrome.runtime.sendMessage({ type: MSG_GET }).then(
      (res) => {
        if (res) setVolume(res.volume);
      },
      () => {},
    );
  } catch (_e) {} // uzantı yeniden yüklendiyse bağlam geçersiz olabilir
})();
