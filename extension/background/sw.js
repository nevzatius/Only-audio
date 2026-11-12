import { SITES, isSiteActive, normalize, genericScriptId, GENERIC_ID_PREFIX } from '../shared/settings.js';

async function readSettings() {
  const raw = await chrome.storage.local.get(['enabled', 'sites', 'customSites']);
  return normalize(raw);
}

// Kullanıcının eklediği siteler: kalıp başına iki betik (MAIN world adaptör + izole dünya köprüsü/kapak CSS).
// Yalnız tarayıcı izni gerçekten verilmiş kalıplar kaydedilir; izin geri alınırsa kayıt silinir.
async function syncCustomSites(settings) {
  try {
    const desired = new Map();
    if (settings.enabled) {
      for (const pattern of settings.customSites) {
        let granted = false;
        try {
          granted = await chrome.permissions.contains({ origins: [pattern] });
        } catch (_e) {}
        if (!granted) continue;
        const mainId = genericScriptId('main', pattern);
        const bridgeId = genericScriptId('bridge', pattern);
        desired.set(mainId, {
          id: mainId,
          js: ['adapters/generic/main.js'],
          matches: [pattern],
          world: 'MAIN',
          runAt: 'document_start',
        });
        desired.set(bridgeId, {
          id: bridgeId,
          js: ['content/bridge.js'],
          css: ['content/cover.css'],
          matches: [pattern],
          runAt: 'document_start',
        });
      }
    }
    const registered = await chrome.scripting.getRegisteredContentScripts();
    const have = new Set(registered.map((s) => s.id).filter((id) => id.startsWith(GENERIC_ID_PREFIX)));
    const stale = [...have].filter((id) => !desired.has(id));
    if (stale.length) await chrome.scripting.unregisterContentScripts({ ids: stale });
    const add = [...desired.values()].filter((s) => !have.has(s.id));
    if (add.length) await chrome.scripting.registerContentScripts(add);
  } catch (err) {
    console.warn('[only-audio] özel site betikleri senkronlanamadı:', err);
  }
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
      await syncCustomSites(settings);
    })
    .catch((err) => console.warn('[only-audio] sync hatası:', err));
  return chain;
}

chrome.runtime.onInstalled.addListener(() => sync());
chrome.runtime.onStartup.addListener(() => sync());
chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') sync();
});
// İzin kullanıcı tarafından tarayıcı ayarlarından geri alınabilir/verilebilir.
chrome.permissions.onAdded.addListener(() => sync());
chrome.permissions.onRemoved.addListener(() => sync());
sync();
