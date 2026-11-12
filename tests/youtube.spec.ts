import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchBrave, firstPage, countBytes, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { openYoutube, openYoutubeUrl, videoStats, playbackStats, currentVideoId, clickRelatedVod } from './helpers/sites';
import type { Page } from '@playwright/test';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');
const VIDEO_ID = 'aqz-KE-bpKQ';

// Eşikler: docs/plan-faz1.md "Eşikler". Test geçsin diye değiştirilmez.
// googlevideo.com baytı, 45 sn'de kümülatif. Kaynak: recon §1 kancalı 60. sn ölçümü 2,16 MB;
// kümülatif olduğundan 45. sn altında kalmalı (kancasız 45. sn: 6,65 MB).
const MAX_GOOGLEVIDEO_BYTES = 2_160_000;
// totalVideoFrames = 0. Kaynak: recon §1 tablo, kancalı çözülen kare 0.
const EXPECTED_TOTAL_VIDEO_FRAMES = 0;
// videoWidth = 0. Kaynak: recon §1 tablo, kancalı videoWidth 0.
const EXPECTED_VIDEO_WIDTH = 0;
// currentTime >= 40. Kaynak: recon §1, kancalıyken 90 sn'de currentTime 89; 5 sn başlangıç payı.
const MIN_CURRENT_TIME = 40;
// Ölçüm süresi gezinmeden itibaren duvar saatiyle (recon ölçümü gibi).
const WINDOW_MS = 45_000;

// ---- SPA geçişi (VOD → VOD) ----
// İkinci videoda: totalVideoFrames = 0 (VOD testiyle aynı ölçüt) ve currentTime ilerliyor.
const SPA_WINDOW_MS = 20_000;
// 20 sn pencerede currentTime artışı >= 15 (5 sn pay; VOD testiyle aynı oran).
const SPA_MIN_TIME_DELTA = 15;

// ---- Canlı (/@LofiGirl/live) ----
const LIVE_URL = 'https://www.youtube.com/@LofiGirl/live';
const LIVE_WINDOW_MS = 45_000;
// Arabellek (currentTime'dan ileri) hiçbir örnekte 10 sn'yi aşmamalı.
const LIVE_MAX_BUFFER_SEC = 10;
// 45 sn pencerede currentTime artışı >= 35 (10 sn pay: canlıda yeniden arabellekleme).
const LIVE_MIN_TIME_DELTA = 35;
// Pencere sonunda videoHeight <= 144 (fallback 144p).
const LIVE_MAX_VIDEO_HEIGHT = 144;

// ---- Aç/kapa ----
// Popup'ta kapatınca 10 sn içinde görüntü (kare + videoWidth > 0) gelmeli.
const TOGGLE_DEADLINE_MS = 10_000;
// Kapatmadan önce en az bu kadar oynatılmış olmalı (konum korunumu 0'dan ayırt edilsin).
const TOGGLE_MIN_BEFORE_TIME = 15;
// Konum korunumu: yeni currentTime >= önceki - 1 (URL ?t= tam saniyeye yuvarlanır).
const TOGGLE_TIME_TOLERANCE = 1;

let brave: LaunchedBrave | undefined;

/** Koşul doğru olana dek (en çok ms) 500 ms aralıkla yoklar; sayfa yenilenirken hatalar yutulur. */
async function waitUntil(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn().catch(() => false)) return true;
    await sleep(500);
  }
  return false;
}

/** Atlanabilir reklamı atlar; reklam (ad-showing) sürüyorsa true döner. Reklam akışı içerik ölçümünü bozar. */
async function adActive(page: Page): Promise<boolean> {
  const skip = page.locator('.ytp-skip-ad-button, .ytp-ad-skip-button, .ytp-ad-skip-button-modern').first();
  if (await skip.isVisible().catch(() => false)) await skip.click({ timeout: 1000 }).catch(() => undefined);
  return (await page.locator('#movie_player.ad-showing').count()) > 0;
}

async function playerVideoId(page: Page): Promise<string> {
  return page
    .evaluate(() => {
      const p = document.getElementById('movie_player') as unknown as { getVideoData?: () => { video_id?: string } } | null;
      return (p && p.getVideoData && p.getVideoData().video_id) || '';
    })
    .catch(() => '');
}

test.afterEach(async () => {
  if (brave) await brave.close();
  brave = undefined;
});

test('YouTube VOD: yalnız ses, düşük bayt, kare yok', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);
  const counter = await countBytes(page, /googlevideo\.com/);

  const t0 = await openYoutube(page, VIDEO_ID);
  while (Date.now() - t0 < WINDOW_MS) await sleep(250);

  const bytes = counter.bytes();
  const stats = await videoStats(page);
  const coverCount = await page.locator('#only-audio-cover[data-mode="audio"]').count();
  console.log('YouTube ölçüm: bayt=' + bytes + ' kare=' + stats.totalVideoFrames + ' videoWidth=' + stats.videoWidth + ' currentTime=' + stats.currentTime.toFixed(1) + ' istek=' + counter.requestCount() + ' kapak=' + coverCount);
  await counter.stop();

  expect.soft(stats.found, 'video öğesi bulunmalı').toBe(true);
  expect.soft(bytes, 'googlevideo.com bayt').toBeLessThan(MAX_GOOGLEVIDEO_BYTES);
  expect.soft(stats.totalVideoFrames, 'totalVideoFrames').toBe(EXPECTED_TOTAL_VIDEO_FRAMES);
  expect.soft(stats.videoWidth, 'videoWidth').toBe(EXPECTED_VIDEO_WIDTH);
  expect.soft(stats.currentTime, 'currentTime').toBeGreaterThanOrEqual(MIN_CURRENT_TIME);
  await expect.soft(page.locator('#only-audio-cover[data-mode="audio"]'), 'kapak görünür').toBeVisible({ timeout: 2000 });
});

test('YouTube SPA: VOD → VOD (yenilemesiz), ikinci videoda kare yok', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);
  await openYoutube(page, VIDEO_ID);
  const first = await waitUntil(async () => ((await playbackStats(page))?.currentTime ?? 0) >= 3, 40_000);
  expect(first, 'ilk video oynamaya başlamalı').toBe(true);

  // Sayfa yenilenirse bu işaret kaybolur: gezinmenin SPA olduğunu kanıtlar.
  await page.evaluate(() => { (window as unknown as { __oaSpa: number }).__oaSpa = 1; });
  const nextId = await clickRelatedVod(page, VIDEO_ID);
  console.log('YouTube SPA: ' + VIDEO_ID + ' -> ' + nextId);

  const arrived = await waitUntil(async () => (await currentVideoId(page)) === nextId && (await playerVideoId(page)) === nextId, 20_000);
  expect(arrived, 'ikinci videoya geçilmeli').toBe(true);
  const marker = await page.evaluate(() => (window as unknown as { __oaSpa?: number }).__oaSpa ?? 0);
  expect(marker, 'sayfa yenilenmemeli (SPA geçişi)').toBe(1);

  // İkinci videonun İÇERİĞİ oynamaya başlasın: reklam (ad-showing) bitene dek beklenir,
  // atlanabilir reklam atlanır. Reklam akışı içerik ölçümünü bozar; eşikler değişmez.
  const playing = await waitUntil(async () => {
    if (await adActive(page)) return false;
    const s = await playbackStats(page);
    return !!s && s.found && !s.paused && s.currentTime >= 1;
  }, 90_000);
  expect(playing, 'ikinci videonun içeriği oynamaya başlamalı (reklam bitince)').toBe(true);

  const s1 = (await playbackStats(page))!;
  const t0 = Date.now();
  while (Date.now() - t0 < SPA_WINDOW_MS) await sleep(250);
  const s2 = (await playbackStats(page))!;
  const adShowing = await page.locator('#movie_player.ad-showing').count();
  console.log('YouTube SPA ölçüm: kare=' + s2.totalVideoFrames + ' videoWidth=' + s2.videoWidth + ' currentTime ' + s1.currentTime.toFixed(1) + ' -> ' + s2.currentTime.toFixed(1) + ' reklam=' + adShowing);

  expect.soft(s2.totalVideoFrames, 'ikinci videoda totalVideoFrames').toBe(EXPECTED_TOTAL_VIDEO_FRAMES);
  expect.soft(s2.currentTime - s1.currentTime, 'ikinci videoda currentTime artışı').toBeGreaterThanOrEqual(SPA_MIN_TIME_DELTA);
});

test('YouTube canlı (@LofiGirl): kısa arabellek, currentTime ilerler, ≤144p', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);
  await openYoutubeUrl(page, LIVE_URL);

  // Kanca canlıyı algılayınca sayfa kancasız yeniden yüklenir; kapak reason=live olunca oturmuştur.
  const settled = await waitUntil(async () => {
    if ((await page.locator('#only-audio-cover[data-reason="live"]').count()) === 0) return false;
    if (await adActive(page)) return false;
    const s = await playbackStats(page);
    return !!s && s.found && !s.paused && s.readyState >= 3;
  }, 90_000);
  expect(settled, 'canlı yayın fallback modunda oynamalı (kapak reason=live)').toBe(true);

  const first = (await playbackStats(page))!;
  let maxBuffer = 0;
  let last = first;
  let adSamples = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < LIVE_WINDOW_MS) {
    const ad = await adActive(page).catch(() => false);
    const s = await playbackStats(page);
    if (ad) adSamples++; // pencere ortasındaki reklam örnekleri içerik ölçümüne katılmaz
    else if (s && s.found) {
      last = s;
      if (s.bufferedAhead > maxBuffer) maxBuffer = s.bufferedAhead;
    }
    await sleep(1000);
  }
  console.log('YouTube canlı ölçüm: maxArabellek=' + maxBuffer.toFixed(1) + ' currentTime ' + first.currentTime.toFixed(1) + ' -> ' + last.currentTime.toFixed(1) + ' videoHeight=' + last.videoHeight + ' videoWidth=' + last.videoWidth + ' reklamÖrneği=' + adSamples);

  expect.soft(maxBuffer, 'ileri arabellek (sn)').toBeLessThanOrEqual(LIVE_MAX_BUFFER_SEC);
  expect.soft(last.currentTime - first.currentTime, 'currentTime artışı').toBeGreaterThanOrEqual(LIVE_MIN_TIME_DELTA);
  expect.soft(last.videoHeight, 'videoHeight').toBeLessThanOrEqual(LIVE_MAX_VIDEO_HEIGHT);
});

test('YouTube aç/kapa: popup anahtarı kapatınca görüntü gelir, konum korunur', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);
  await openYoutube(page, VIDEO_ID);

  const audioOnly = await waitUntil(async () => {
    const s = await playbackStats(page);
    return !!s && s.found && !s.paused && s.currentTime >= TOGGLE_MIN_BEFORE_TIME && s.totalVideoFrames === 0 && s.videoWidth === 0;
  }, 60_000);
  expect(audioOnly, 'kapatmadan önce yalnız ses modunda oynamalı').toBe(true);
  const before = (await playbackStats(page))!;

  // Popup'ı sekme olarak aç (açılır pencere otomasyonla açılamaz) ve ana anahtarı kapat.
  const popup = await brave.context.newPage();
  await popup.goto('chrome-extension://' + brave.extensionId + '/popup/popup.html');
  await expect(popup.locator('#toggle-enabled')).toBeChecked();
  const tToggle = Date.now();
  await popup.locator('#toggle-enabled').uncheck();
  await expect(popup.locator('#note')).toBeVisible(); // ayar kaydedildi
  await popup.close();
  await page.bringToFront();

  let afterTime = -1;
  const gotVideo = await waitUntil(async () => {
    const s = await playbackStats(page);
    if (s && s.found && s.totalVideoFrames > 0 && s.videoWidth > 0) { afterTime = s.currentTime; return true; }
    return false;
  }, Math.max(0, TOGGLE_DEADLINE_MS - (Date.now() - tToggle)));
  console.log('YouTube aç/kapa: görüntü=' + gotVideo + ' süre=' + (Date.now() - tToggle) + 'ms önceki currentTime=' + before.currentTime.toFixed(1) + ' sonraki=' + afterTime.toFixed(1));

  expect(gotVideo, 'kapatınca ' + TOGGLE_DEADLINE_MS / 1000 + ' sn içinde kare ve videoWidth > 0').toBe(true);
  expect.soft(afterTime, 'currentTime korunmalı').toBeGreaterThanOrEqual(before.currentTime - TOGGLE_TIME_TOLERANCE);
  await expect.soft(page.locator('#only-audio-cover'), 'kapak kalkmalı').toHaveCount(0);
});
