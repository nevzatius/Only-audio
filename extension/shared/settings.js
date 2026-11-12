// Paylaşılan ayarlar: service worker, popup ve birim testleri içe aktarır.

export const DEFAULTS = Object.freeze({
  enabled: true,
  sites: Object.freeze({ youtube: true, twitch: true, kick: true }),
});

// Site kayıt tablosu: service worker bunu MAIN world içerik betiği olarak kaydeder.
export const SITES = Object.freeze({
  youtube: Object.freeze({
    id: 'oa-youtube-main',
    js: ['adapters/youtube/main.js'],
    matches: ['*://www.youtube.com/*'],
  }),
  twitch: Object.freeze({
    id: 'oa-twitch-main',
    js: ['adapters/twitch/main.js'],
    matches: ['*://www.twitch.tv/*'],
    ruleset: 'twitch',
  }),
  kick: Object.freeze({
    id: 'oa-kick-main',
    js: ['adapters/kick/main.js'],
    matches: ['*://kick.com/*', '*://www.kick.com/*'],
    ruleset: 'kick',
  }),
});

export function normalize(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const srcSites = src.sites && typeof src.sites === 'object' ? src.sites : {};
  const sites = {};
  for (const key of Object.keys(DEFAULTS.sites)) {
    sites[key] = typeof srcSites[key] === 'boolean' ? srcSites[key] : DEFAULTS.sites[key];
  }
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULTS.enabled,
    sites,
  };
}

export function isSiteActive(settings, site) {
  return Boolean(settings && settings.enabled && settings.sites && settings.sites[site] === true);
}
