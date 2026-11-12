import { test, expect } from '@playwright/test';
import {
  clampVolume,
  isOverride,
  percentToVolume,
  volumeToPercent,
  mergeTabs,
  tabOriginPattern,
  storeKey,
  shouldOfferTabNames,
} from '../../extension/shared/volume.js';
import { hashPattern, genericScriptId } from '../../extension/shared/settings.js';

test('clampVolume: aralığa sıkıştırır, geçersizde null', () => {
  expect(clampVolume(0.3)).toBe(0.3);
  expect(clampVolume(-1)).toBe(0);
  expect(clampVolume(2)).toBe(1);
  expect(clampVolume(NaN)).toBeNull();
  expect(clampVolume(Infinity)).toBeNull();
  expect(clampVolume('0.5')).toBeNull();
  expect(clampVolume(undefined)).toBeNull();
});

test('isOverride: yalnız %100 altı geçersiz kılmadır', () => {
  expect(isOverride(0)).toBe(true);
  expect(isOverride(0.99)).toBe(true);
  expect(isOverride(1)).toBe(false);
  expect(isOverride(1.5)).toBe(false);
  expect(isOverride(null)).toBe(false);
});

test('yüzde dönüşümleri', () => {
  expect(percentToVolume(30)).toBe(0.3);
  expect(percentToVolume('100')).toBe(1);
  expect(percentToVolume('x')).toBeNull();
  expect(volumeToPercent(0.3)).toBe(30);
  expect(volumeToPercent(null)).toBe(100);
});

test('mergeTabs: kimliğe göre tekilleştirir, sırayı korur, bozuk girdiyi atar', () => {
  const a = { id: 1 };
  const b = { id: 2 };
  expect(mergeTabs([a, b], [b, { id: 3 }])).toEqual([a, b, { id: 3 }]);
  expect(mergeTabs(undefined, [null, { id: 'x' }, a])).toEqual([a]);
});

test('tabOriginPattern: yalnız http/https kaynağı', () => {
  expect(tabOriginPattern('https://www.youtube.com/watch?v=1')).toBe('https://www.youtube.com/*');
  expect(tabOriginPattern('http://127.0.0.1:8080/a')).toBe('http://127.0.0.1/*');
  expect(tabOriginPattern('brave://settings')).toBeNull();
  expect(tabOriginPattern('')).toBeNull();
  expect(tabOriginPattern(undefined)).toBeNull();
});

test('storeKey ve betik kimliği özeti', () => {
  expect(storeKey(7)).toBe('vol:7');
  expect(genericScriptId('main', '*://a.com/*')).toBe('oa-generic-main-' + hashPattern('*://a.com/*'));
});

test('shouldOfferTabNames: yalnız izin yokken ve adresi gizli sekme varsa', () => {
  const hidden = { id: 1 };
  const shown = { id: 2, url: 'https://a.com/' };
  expect(shouldOfferTabNames([hidden, shown], false)).toBe(true);
  expect(shouldOfferTabNames([shown], false)).toBe(false);
  expect(shouldOfferTabNames([], false)).toBe(false);
  expect(shouldOfferTabNames([hidden], true)).toBe(false); // izin verilmişse düğme gizlenir
  expect(shouldOfferTabNames(undefined, false)).toBe(false);
  expect(shouldOfferTabNames([null, { id: 'x' }], false)).toBe(false);
});
