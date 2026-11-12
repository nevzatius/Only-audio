import { test, expect } from '@playwright/test';
import {
  DEFAULTS,
  normalize,
  isSiteActive,
  SITES,
  isValidPattern,
  isBuiltInHost,
  originPatternFor,
  patternHost,
  genericScriptId,
} from '../../extension/shared/settings.js';

test('DEFAULTS: hepsi açık, özel site yok', () => {
  expect(DEFAULTS).toEqual({ enabled: true, sites: { youtube: true, twitch: true, kick: true }, customSites: [] });
});

test('normalize: boş/bozuk girdi varsayılana döner', () => {
  expect(normalize(undefined)).toEqual(DEFAULTS);
  expect(normalize(null)).toEqual(DEFAULTS);
  expect(normalize('x')).toEqual(DEFAULTS);
  expect(normalize({})).toEqual(DEFAULTS);
  expect(normalize({ enabled: 'evet', sites: 5, customSites: 'x' })).toEqual(DEFAULTS);
});

test('normalize: geçerli alanlar korunur, eksikler doldurulur', () => {
  expect(normalize({ enabled: false })).toEqual({ enabled: false, sites: { youtube: true, twitch: true, kick: true }, customSites: [] });
  expect(normalize({ sites: { twitch: false } })).toEqual({ enabled: true, sites: { youtube: true, twitch: false, kick: true }, customSites: [] });
  expect(normalize({ sites: { youtube: 'x', twitch: false } }).sites).toEqual({ youtube: true, twitch: false, kick: true });
});

test('normalize: bilinmeyen siteler atılır, girdi değiştirilmez', () => {
  const raw = { enabled: true, sites: { youtube: false, vimeo: true } };
  const out = normalize(raw);
  expect(out.sites).toEqual({ youtube: false, twitch: true, kick: true });
  expect(raw.sites).toEqual({ youtube: false, vimeo: true });
  out.sites.youtube = true;
  expect(DEFAULTS.sites.youtube).toBe(true);
});

test('normalize: customSites geçerli kalıpları korur, geçersiz/yinelenen/yerleşik olanları atar', () => {
  const out = normalize({
    customSites: [
      '*://example.com/*',
      '*://example.com/*', // yinelenen
      '*://www.youtube.com/*', // yerleşik
      '*://kick.com/*', // yerleşik
      '*://*.example.org/*', // joker alt alan adı desteklenmez
      'https://example.net/*', // şema '*' değil
      '*://example.net/path/*', // yol sabit '/*' değil
      42,
      null,
      '*://127.0.0.1/*',
    ],
  });
  expect(out.customSites).toEqual(['*://example.com/*', '*://127.0.0.1/*']);
  out.customSites.push('*://x.test/*');
  expect(DEFAULTS.customSites).toEqual([]);
});

test('isValidPattern / isBuiltInHost', () => {
  expect(isValidPattern('*://example.com/*')).toBe(true);
  expect(isValidPattern('*://localhost/*')).toBe(true);
  expect(isValidPattern('*://twitch.tv/*')).toBe(false);
  expect(isValidPattern('*://m.twitch.tv/*')).toBe(false);
  expect(isValidPattern('*://nottwitch.tv/*')).toBe(true); // yalnız gerçek alt alan adları yerleşik sayılır
  expect(isValidPattern(undefined)).toBe(false);
  expect(isBuiltInHost('www.youtube.com')).toBe(true);
  expect(isBuiltInHost('KICK.com')).toBe(true);
  expect(isBuiltInHost('example.com')).toBe(false);
});

test('originPatternFor: yalnız http/https, port yok sayılır, yerleşikler null', () => {
  expect(originPatternFor('https://Example.com/a/b?x=1')).toBe('*://example.com/*');
  expect(originPatternFor('http://127.0.0.1:8080/x')).toBe('*://127.0.0.1/*');
  expect(originPatternFor('chrome://extensions')).toBeNull();
  expect(originPatternFor('chrome-extension://abc/popup.html')).toBeNull();
  expect(originPatternFor('file:///c:/a.html')).toBeNull();
  expect(originPatternFor('https://www.youtube.com/watch?v=1')).toBeNull();
  expect(originPatternFor('http://[::1]/')).toBeNull();
  expect(originPatternFor('')).toBeNull();
  expect(originPatternFor('çöp')).toBeNull();
});

test('patternHost / genericScriptId: kararlı ve ayrık', () => {
  expect(patternHost('*://example.com/*')).toBe('example.com');
  expect(patternHost('bozuk')).toBe('');
  const a = genericScriptId('main', '*://example.com/*');
  expect(a).toBe(genericScriptId('main', '*://example.com/*'));
  expect(a).toMatch(/^oa-generic-main-[0-9a-z]+$/);
  expect(a).not.toBe(genericScriptId('bridge', '*://example.com/*'));
  expect(a).not.toBe(genericScriptId('main', '*://example.org/*'));
});

test('isSiteActive: enabled && sites[site]', () => {
  const s = normalize({ enabled: true, sites: { youtube: true, twitch: false } });
  expect(isSiteActive(s, 'youtube')).toBe(true);
  expect(isSiteActive(s, 'twitch')).toBe(false);
  expect(isSiteActive(normalize({ enabled: false }), 'youtube')).toBe(false);
  expect(isSiteActive(s, 'bilinmeyen')).toBe(false);
});

test('SITES: kayıt tablosu', () => {
  expect(Object.keys(SITES).sort()).toEqual(['kick', 'twitch', 'youtube']);
  expect(SITES.youtube).toMatchObject({
    id: 'oa-youtube-main',
    js: ['adapters/youtube/main.js'],
    matches: ['*://www.youtube.com/*'],
  });
  expect(SITES.twitch).toMatchObject({
    id: 'oa-twitch-main',
    js: ['adapters/twitch/main.js'],
    matches: ['*://www.twitch.tv/*'],
    ruleset: 'twitch',
  });
  expect(SITES.kick).toMatchObject({
    id: 'oa-kick-main',
    js: ['adapters/kick/main.js'],
    matches: ['*://kick.com/*', '*://www.kick.com/*'],
    ruleset: 'kick',
  });
});
