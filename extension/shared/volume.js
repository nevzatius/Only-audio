// Sekme ses kontrolcüsü: popup, service worker ve birim testleri için paylaşılan saf mantık.
// Sözleşme: docs/plan-faz5.md.

export const VOLUME_ID_PREFIX = 'oa-vol-';
export const STORE_PREFIX = 'vol:';

// Mesaj türleri. get: içerik betiği → SW; set: popup → SW; apply/ping: SW/popup → içerik betiği.
export const MSG = Object.freeze({
  GET: 'oa-vol:get',
  SET: 'oa-vol:set',
  APPLY: 'oa-vol:apply',
  PING: 'oa-vol:ping',
});

export function storeKey(tabId) {
  return STORE_PREFIX + tabId;
}

// Geçerli bir ses değeri 0..1 arası sonlu sayıdır; değilse null.
export function clampVolume(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(1, Math.max(0, v));
}

// Geçersiz kılma yalnız %100 altındaki değerlerde vardır; %100 ve üstü "sitenin kendi sesi" demektir.
export function isOverride(v) {
  const c = clampVolume(v);
  return c !== null && c < 1;
}

export function percentToVolume(p) {
  return clampVolume(Number(p) / 100);
}

export function volumeToPercent(v) {
  const c = clampVolume(v);
  return c === null ? 100 : Math.round(c * 100);
}

// Sesli ve sessize alınmış sekme listelerini sekme kimliğine göre tekilleştirir; sıra korunur.
export function mergeTabs(...lists) {
  const seen = new Set();
  const out = [];
  for (const list of lists) {
    for (const tab of Array.isArray(list) ? list : []) {
      if (!tab || typeof tab.id !== 'number' || seen.has(tab.id)) continue;
      seen.add(tab.id);
      out.push(tab);
    }
  }
  return out;
}

// Adres alanı boş gelen sekme, "tabs" izni olmadan başlığı/adresi/simgesi gizlenmiş sekmedir.
// İzin verildiğinde bu alanlar dolu gelir; bu yüzden düğme yalnız izin yokken ve gizli sekme varken gösterilir.
export function shouldOfferTabNames(tabs, hasTabsPermission) {
  if (hasTabsPermission) return false;
  return (Array.isArray(tabs) ? tabs : []).some((t) => t && typeof t.id === 'number' && !t.url);
}

// İzin sorgusu için sekme adresinin kaynağı ('https://ornek.com/*'); http/https dışı ya da adres yoksa null.
// Not: adres alanı yalnız host iznimiz olan sekmelerde (ve aktif sekmede) dolu gelir.
export function tabOriginPattern(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch (_e) {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.protocol + '//' + u.hostname + '/*'; // port match pattern'lerde yer almaz
}
