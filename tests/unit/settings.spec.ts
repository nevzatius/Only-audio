import { test, expect } from '@playwright/test';
import { DEFAULTS, normalize, isSiteActive, SITES } from '../../extension/shared/settings.js';

test('DEFAULTS: hepsi açık', () => {
  expect(DEFAULTS).toEqual({ enabled: true, sites: { youtube: true, twitch: true, kick: true } });
});

test('normalize: boş/bozuk girdi varsayılana döner', () => {
  expect(normalize(undefined)).toEqual(DEFAULTS);
  expect(normalize(null)).toEqual(DEFAULTS);
  expect(normalize('x')).toEqual(DEFAULTS);
  expect(normalize({})).toEqual(DEFAULTS);
  expect(normalize({ enabled: 'evet', sites: 5 })).toEqual(DEFAULTS);
});

test('normalize: geçerli alanlar korunur, eksikler doldurulur', () => {
  expect(normalize({ enabled: false })).toEqual({ enabled: false, sites: { youtube: true, twitch: true, kick: true } });
  expect(normalize({ sites: { twitch: false } })).toEqual({ enabled: true, sites: { youtube: true, twitch: false, kick: true } });
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
