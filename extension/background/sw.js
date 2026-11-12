import { SITES, isSiteActive, normalize } from '../shared/settings.js';

async function readSettings() {
  const raw = await chrome.storage.local.get(['enabled', 'sites']);
  return normalize(raw);
}

async function syncSite(name, settings) {
  const site = SITES[name];
  const want = isSiteActive(settings, name);
  try {
    const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [site.id] });
    const registered = existing.length > 0;
    if (want && !registered) {
      await chrome.scripting.registerContentScripts([
        { id: site.id, js: site.js, matches: site.matches, world: 'MAIN', runAt: 'document_start' },
      ]);
    } else if (!want && registered) {
      await chrome.scripting.unregisterContentScripts({ ids: [site.id] });
    }
  } catch (err) {
    console.warn(`[only-audio] ${name} içerik betiği senkronlanamadı:`, err);
  }
  if (site.ruleset) {
    try {
      const enabledNow = await chrome.declarativeNetRequest.getEnabledRulesets();
      const on = enabledNow.includes(site.ruleset);
      if (want !== on) {
        await chrome.declarativeNetRequest.updateEnabledRulesets(
          want ? { enableRulesetIds: [site.ruleset] } : { disableRulesetIds: [site.ruleset] },
        );
      }
    } catch (err) {
      console.warn(`[only-audio] ${name} kural kümesi senkronlanamadı:`, err);
    }
  }
}

let chain = Promise.resolve();

// Çağrılar sıraya dizilir; idempotent.
export function sync() {
  chain = chain
    .catch(() => {})
    .then(async () => {
      const settings = await readSettings();
      for (const name of Object.keys(SITES)) await syncSite(name, settings);
    })
    .catch((err) => console.warn('[only-audio] sync hatası:', err));
  return chain;
}

chrome.runtime.onInstalled.addListener(() => sync());
chrome.runtime.onStartup.addListener(() => sync());
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') sync();
});
sync();
