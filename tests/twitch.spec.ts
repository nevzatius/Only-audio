import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchBrave, firstPage, countBytes, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { findTwitchChannel, openTwitchChannel, dismissTwitchBlockers, videoStats } from './helpers/sites';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');

// Eşikler: docs/plan-faz1.md "Eşikler". Test geçsin diye değiştirilmez.
// *.ttvnw.net bayt hızı < 60 KB/sn (30 sn'de < 1 800 000 B). Kaynak: recon §3 "Kanala göre audio_only bayt hızı".
// Eşik 2026-11-11'de kullanıcı onayıyla 40 → 60 KB/sn yapıldı: audio_only hızı kanalın kaynak ses bitrate'ine bağlı (ölçülen 31–45 kB/sn; 320 kbps ses + TS/playlist yükü ~45). Yalnız-ses/160p ayrımını kare ve videoWidth ölçütleri yapar. Varsayılan ~440 KB/sn.
const WINDOW_SEC = 30;
const MAX_WINDOW_BYTES = 1_800_000;
// Pencere içi totalVideoFrames artışı = 0. Kaynak: recon §2 tablo, audio_only 0.
const EXPECTED_FRAME_DELTA = 0;
// videoWidth = 0. Kaynak: recon §2 tablo, audio_only 0.
const EXPECTED_VIDEO_WIDTH = 0;
// Pencere içi currentTime artışı >= 25. Kaynak: 30 sn pencere, 5 sn pay.
const MIN_CURRENT_TIME_DELTA = 25;
// Geçiş bekleme üst sınırı (preroll olabilir). Kaynak: plan-faz1 "en çok 90 sn".
const SWITCH_WAIT_MS = 90_000;

let brave: LaunchedBrave | undefined;

test.afterEach(async () => {
  if (brave) await brave.close();
  brave = undefined;
});

test('Twitch canlı: yalnız ses, düşük bayt hızı, kare yok', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);
  const channel = await findTwitchChannel(page);
  console.log('Twitch kanal: ' + channel);

  const counter = await countBytes(page, /\.ttvnw\.net/);
  await openTwitchChannel(page, channel);

  // Geçişi sayfadan bağımsız bekle: videoWidth === 0 ve currentTime ilerliyor.
  const tStart = Date.now();
  let switched = false;
  let last = await videoStats(page);
  while (Date.now() - tStart < SWITCH_WAIT_MS) {
    await sleep(2000);
    await dismissTwitchBlockers(page);
    const s = await videoStats(page);
    if (s.found && s.videoWidth === 0 && s.currentTime > last.currentTime + 0.5 && s.currentTime > 0) { switched = true; break; }
    last = s;
  }
  if (!switched) {
    const s = await videoStats(page);
    console.log('Twitch geçiş olmadı: ' + JSON.stringify(s) + ' bayt=' + counter.bytes());
  }

  // 30 sn pencere (geçiş olmasa da ölçülür; eşikler yine de uygulanır)
  const b0 = counter.bytes();
  const s0 = await videoStats(page);
  const t0 = Date.now();
  while (Date.now() - t0 < WINDOW_SEC * 1000) {
    await sleep(2000);
    await dismissTwitchBlockers(page);
  }
  const winBytes = counter.bytes() - b0;
  const s1 = await videoStats(page);
  const frameDelta = s1.totalVideoFrames - s0.totalVideoFrames;
  const timeDelta = s1.currentTime - s0.currentTime;
  console.log('Twitch ölçüm: pencere bayt=' + winBytes + ' (' + (winBytes / 1024 / WINDOW_SEC).toFixed(1) + ' KB/sn) kareArtışı=' + frameDelta + ' videoWidth=' + s1.videoWidth + ' currentTimeArtışı=' + timeDelta.toFixed(1) + ' workerİstek=' + counter.workerRequestCount() + ' geçiş=' + switched);
  await counter.stop();

  expect.soft(switched, 'geçiş (videoWidth 0 ve currentTime ilerliyor) 90 sn içinde olmalı').toBe(true);
  expect.soft(winBytes, 'ttvnw.net 30 sn bayt').toBeLessThan(MAX_WINDOW_BYTES);
  expect.soft(frameDelta, 'pencere içi totalVideoFrames artışı').toBe(EXPECTED_FRAME_DELTA);
  expect.soft(s1.videoWidth, 'videoWidth').toBe(EXPECTED_VIDEO_WIDTH);
  expect.soft(timeDelta, 'pencere içi currentTime artışı').toBeGreaterThanOrEqual(MIN_CURRENT_TIME_DELTA);
  await expect.soft(page.locator('#only-audio-cover[data-mode="audio"]'), 'kapak görünür').toBeVisible({ timeout: 2000 });
});
