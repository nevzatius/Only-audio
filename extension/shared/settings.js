// Paylaşılan ayarlar: service worker, popup ve birim testleri içe aktarır.

export const DEFAULTS = Object.freeze({
  enabled: true,
  sites: Object.freeze({ youtube: true, twitch: true, kick: true }),
  // Kullanıcının çalışma anında eklediği siteler (genel adaptör): '*://ornek.com/*' kalıpları.
  customSites: Object.freeze([]),
});

// Yerleşik adaptörü olan alan adları: genel adaptör bunlara eklenemez.
export const BUILTIN_DOMAINS = Object.freeze(['youtube.com', 'twitch.tv', 'kick.com']);

export const GENERIC_ID_PREFIX = 'oa-generic-';

const PATTERN_RE = /^\*:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*)\/\*$/;

export function isBuiltInHost(host) {
  const h = String(host).toLowerCase();
  return BUILTIN_DOMAINS.some((d) => h === d || h.endsWith('.' + d));
}

export function isValidPattern(p) {
  if (typeof p !== 'string') return false;
  const m = PATTERN_RE.exec(p);
  return !!m && !isBuiltInHost(m[1]);
}

export function patternHost(p) {
  const m = typeof p === 'string' ? PATTERN_RE.exec(p) : null;
  return m ? m[1] : '';
}

// Sayfa adresinden eklenebilir kalıp üretir (yalnız http/https, port yok sayılır); yoksa null.
export function originPatternFor(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch (_e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const p = '*://' + u.hostname.toLowerCase() + '/*';
  return isValidPattern(p) ? p : null;
}

// Kalıptan kararlı, kısa özet (betik kimlikleri için).
export function hashPattern(pattern) {
  let h = 5381;
  for (let i = 0; i < pattern.length; i++) h = ((h * 33) ^ pattern.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

// Kalıba bağlı kararlı betik kimliği; kind: 'main' | 'bridge'.
export function genericScriptId(kind, pattern) {
  return GENERIC_ID_PREFIX + kind + '-' + hashPattern(pattern);
}

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
  const customSites = [];
  if (Array.isArray(src.customSites)) {
    for (const p of src.customSites) {
      if (isValidPattern(p) && !customSites.includes(p)) customSites.push(p);
    }
  }
  return {
    enabled: typeof src.enabled === 'boolean' ? src.enabled : DEFAULTS.enabled,
    sites,
    customSites,
  };
}

export function isSiteActive(settings, site) {
  return Boolean(settings && settings.enabled && settings.sites && settings.sites[site] === true);
}
