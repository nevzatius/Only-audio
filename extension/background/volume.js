// Sekme ses kontrolcüsü, service worker tarafı. Sözleşme: docs/plan-faz5.md.
// Değer chrome.storage.session'da (tarayıcı kapanınca silinir), sekme kapanınca anahtar silinir.
// İçerik betikleri session depolamaya erişemez; tek sahip burasıdır.
import { hashPattern } from '../shared/settings.js';
import { MSG, VOLUME_ID_PREFIX, storeKey, clampVolume, isOverride } from '../shared/volume.js';

async function getVolume(tabId) {
  const key = storeKey(tabId);
  const got = await chrome.storage.session.get(key);
  const entry = got[key];
  return entry && isOverride(entry.volume) ? entry.volume : null;
}

async function setVolume(tabId, volume) {
  const key = storeKey(tabId);
  if (isOverride(volume)) await chrome.storage.session.set({ [key]: { volume: clampVolume(volume) } });
  else await chrome.storage.session.remove(key);
}

function fromExtensionPage(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === 'string' && sender.url.startsWith(chrome.runtime.getURL(''));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || typeof msg.type !== 'string') return false;
  if (msg.type === MSG.GET) {
    const tabId = sender.tab && sender.tab.id;
    if (typeof tabId !== 'number') {
      sendResponse({ volume: null });
      return false;
    }
    getVolume(tabId).then(
      (volume) => sendResponse({ volume }),
      () => sendResponse({ volume: null }),
    );
    return true;
  }
  if (msg.type === MSG.SET) {
    // Yalnız uzantı sayfalarından (popup); sayfa içerik betikleri başka sekmeyi ayarlayamaz.
    if (!fromExtensionPage(sender) || typeof msg.tabId !== 'number') return false;
    const volume = clampVolume(msg.volume);
    (async () => {
      await setVolume(msg.tabId, volume);
      let delivered = false;
      try {
        await chrome.tabs.sendMessage(msg.tabId, { type: MSG.APPLY, volume: isOverride(volume) ? volume : null });
        delivered = true;
      } catch (_e) {}
      sendResponse({ ok: true, delivered });
    })().catch(() => sendResponse({ ok: false, delivered: false }));
    return true;
  }
  return false;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(storeKey(tabId)).catch(() => {});
});

// Eklenen siteler: ses betiği ana anahtardan bağımsız, yalnız tarayıcı izni verilmişse kaydedilir.
export async function syncVolumeScripts(customSites) {
  try {
    const desired = new Map();
    for (const pattern of customSites) {
      let granted = false;
      try {
        granted = await chrome.permissions.contains({ origins: [pattern] });
      } catch (_e) {}
      if (!granted) continue;
      const id = VOLUME_ID_PREFIX + hashPattern(pattern);
      desired.set(id, { id, js: ['content/volume.js'], matches: [pattern], runAt: 'document_start' });
    }
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const have = new Set(registered.map((s) => s.id).filter((id) => id.startsWith(VOLUME_ID_PREFIX)));
    const stale = [...have].filter((id) => !desired.has(id));
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
    const add = [...desired.values()].filter((s) => !have.has(s.id));
    if (add.length) await chrome.scripting.registerContentScripts(add);
  } catch (err) {
    console.warn('[only-audio] ses betikleri senkronlanamadı:', err);
  }
}

