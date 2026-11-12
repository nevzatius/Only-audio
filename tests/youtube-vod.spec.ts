import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchBrave, firstPage, countBytes, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { openYoutube, videoStats } from './helpers/sites';

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

let brave: LaunchedBrave | undefined;

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
