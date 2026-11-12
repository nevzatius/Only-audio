// İzole dünya köprüsü: MAIN world adaptör durumunu dinler, kapağı yönetir,
// "Videoya dön" düğmesini MAIN world'e iletir. Sözleşme: docs/plan-faz1.md.
(() => {
  const FROM_MAIN = 'only-audio/main';
  const TO_MAIN = 'only-audio/ext';
  const COVER_ID = 'only-audio-cover';

  let state = null; // son 'status' iletisi (yalnız audio/fallback iken kapak gösterilir)
  let observer = null;
  let scheduled = false;

  function send(type) {
    window.postMessage({ source: TO_MAIN, type }, '*');
  }

  function findContainer() {
    if (!state) return null;
    let el = null;
    try {
      el = document.querySelector(state.playerSelector);
    } catch (_e) {}
    if (!el && state.site === 'twitch') el = document.querySelector('.video-player');
    return el;
  }

  function buildCover() {
    const cover = document.createElement('div');
    cover.id = COVER_ID;

    const title = document.createElement('div');
    title.className = 'oa-title';
    title.textContent = '🎧 Sadece ses';

    const note = document.createElement('div');
    note.className = 'oa-note';
    note.textContent = 'düşük kalite';

    const btn = document.createElement('button');
    btn.id = 'only-audio-restore';
    btn.type = 'button';
    btn.textContent = 'Videoya dön';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      send('restore');
    });

    cover.append(title, note, btn);
    return cover;
  }

  function removeCover() {
    for (const el of document.querySelectorAll('#' + COVER_ID)) el.remove();
  }

  function render() {
    scheduled = false;
    if (!state || (state.mode !== 'audio' && state.mode !== 'fallback')) {
      removeCover();
      return;
    }
    const container = findContainer();
    if (!container) return; // oynatıcı henüz yok; gözlemci tekrar dener
    let cover = container.querySelector(':scope > #' + COVER_ID);
    if (!cover) {
      removeCover(); // eski/yetim kapakları temizle
      cover = buildCover();
      // Twitch: denetim katmanlarının altında kalması için ilk çocuk; YouTube: sona.
      // Kick: videonun hemen ardına (denetim katmanı sonraki kardeş, üstte kalır).
      if (state.site === 'twitch') container.prepend(cover);
      else if (state.site === 'kick' || state.site === 'generic') {
        const video = container.querySelector(':scope > video');
        if (video) video.after(cover);
        else container.prepend(cover);
      } else container.append(cover);
    }
    cover.dataset.mode = state.mode;
    cover.dataset.site = state.site;
    cover.dataset.reason = state.reason || '';
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(render);
  }

  function observe() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (state && (state.mode === 'audio' || state.mode === 'fallback')) {
        const c = findContainer();
        if (!c || !c.querySelector(':scope > #' + COVER_ID)) schedule();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.source !== FROM_MAIN || d.type !== 'status') return;
    state = {
      site: d.site,
      mode: d.mode,
      reason: d.reason,
      playerSelector: typeof d.playerSelector === 'string' ? d.playerSelector : '',
    };
    observe();
    // Mod değişimi anında uygula (rAF gizli sekmede durabilir).
    render();
  });

  // Popup'tan kapatma (YouTube): açık sekme kancasız yeniden yüklenir, konum ?t= ile korunur.
  // Twitch/Kick'te açık sekme davranışı değişmedi ("Açık sekmeleri yenileyin" notu geçerli).
  if (location.hostname === 'www.youtube.com') {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !(changes.enabled || changes.sites)) return;
      chrome.storage.local.get(['enabled', 'sites']).then((raw) => {
        const off = raw.enabled === false || (raw.sites && raw.sites.youtube === false);
        if (off) send('restore');
      });
    });
  }

  // Genel adaptör: site kaldırılınca ya da uzantı kapatılınca açık sekme yenilenmeden geri alınır
  // (MAIN world videoyu görünür yapar, buradaki kapak 'off' durumuyla silinir).
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !(changes.enabled || changes.customSites)) return;
    if (!state || state.site !== 'generic') return;
    chrome.storage.local.get(['enabled', 'customSites']).then((raw) => {
      const list = Array.isArray(raw.customSites) ? raw.customSites : [];
      const on = raw.enabled !== false && list.includes('*://' + location.hostname + '/*');
      if (!on) send('disable');
    });
  });

  send('hello');
})();
