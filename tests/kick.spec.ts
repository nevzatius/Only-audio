import { test, expect } from '@playwright/test';
import * as path from 'node:path';
import { launchBrave, firstPage, countBytes, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { findKickChannels, openKickChannel, dismissKickBlockers, kickVideoStats } from './helpers/sites';

const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');

// Eşikler: docs/plan-faz2b.md "Test". Test geçsin diye değiştirilmez.
// *.live-video.net bayt hızı < 60 KB/sn (45 sn'de < 2 700 000 B). Kaynak: recon §3 "Kanala göre audio_only bayt hızı".
// Eşik 2026-11-11'de kullanıcı onayıyla 40 → 60 KB/sn yapıldı: audio_only hızı kanalın kaynak ses bitrate'ine bağlı (ölçülen 31–45 kB/sn; 320 kbps ses + TS/playlist yükü ~45). Yalnız-ses/160p ayrımını kare ve videoWidth ölçütleri yapar. Varsayılan ~450 KB/sn.
const WINDOW_SEC = 45;
const MAX_WINDOW_BYTES = 2_700_000;
// Pencere içi totalVideoFrames artışı = 0. Kaynak: recon §3 tablo, audio_only 0.
const EXPECTED_FRAME_DELTA = 0;
// videoWidth = 0. Kaynak: recon §3 tablo, audio_only 0.
const EXPECTED_VIDEO_WIDTH = 0;
// Pencere içi currentTime artışı >= 40. Kaynak: 45 sn pencere, 5 sn pay.
const MIN_CURRENT_TIME_DELTA = 40;
// Geçiş bekleme üst sınırı. Kaynak: plan-faz1 Twitch testiyle aynı, "en çok 90 sn".
const SWITCH_WAIT_MS = 90_000;

// Cloudflare/bot kontrolü: engel aşılmaz, test atlanır. Bkz. docs/known-issues.md "Kick: Cloudflare bot kontrolü".
const SKIP_PREFIX = 'Kick Cloudflare/bot kontrolü sayfası döndürdü; engel aşılmaya çalışılmıyor (docs/known-issues.md). Belirti: ';

let brave: LaunchedBrave | undefined;

test.afterEach(async () => {
  if (brave) await brave.close();
  brave = undefined;
});

test('Kick canlı: yalnız ses, düşük bayt hızı, kare yok', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const page = await firstPage(brave.context);

  const found = await findKickChannels(page);
  test.skip(found.blocked !== null, SKIP_PREFIX + found.blocked);

  const counter = await countBytes(page, /\.live-video\.net/);
  let channel = '';
  for (const c of found.channels) {
    const r = await openKickChannel(page, c);
    test.skip(r.blocked !== null, SKIP_PREFIX + r.blocked);
    if (r.playing) { channel = c; break; }
    console.log('Kick kanal oynamadı, sıradaki deneniyor: ' + c);
  }
  expect(channel, 'oynayan canlı kanal bulunmalı (adaylar: ' + found.channels.join(', ') + ')').not.toBe('');
  console.log('Kick kanal: ' + channel);

  // Geçişi sayfadan bağımsız bekle: videoWidth === 0 ve currentTime ilerliyor.
  const tStart = Date.now();
  let switched = false;
  let last = await kickVideoStats(page);
  while (Date.now() - tStart < SWITCH_WAIT_MS) {
    await sleep(2000);
    await dismissKickBlockers(page);
    const s = await kickVideoStats(page);
    if (s.found && s.videoWidth === 0 && s.currentTime > last.currentTime + 0.5 && s.currentTime > 0) { switched = true; break; }
    last = s;
  }
  if (!switched) {
    const s = await kickVideoStats(page);
    console.log('Kick geçiş olmadı: ' + JSON.stringify(s) + ' bayt=' + counter.bytes());
  }

  // 45 sn pencere (geçiş olmasa da ölçülür; eşikler yine de uygulanır)
  const b0 = counter.bytes();
  const s0 = await kickVideoStats(page);
  const bd0 = counter.breakdown();
  const t0 = Date.now();
  while (Date.now() - t0 < WINDOW_SEC * 1000) {
    await sleep(2000);
    await dismissKickBlockers(page);
  }
  const winBytes = counter.bytes() - b0;
  const s1 = await kickVideoStats(page);
  const frameDelta = s1.totalVideoFrames - s0.totalVideoFrames;
  const timeDelta = s1.currentTime - s0.currentTime;
  console.log('Kick ölçüm: pencere bayt=' + winBytes + ' (' + (winBytes / 1024 / WINDOW_SEC).toFixed(1) + ' KB/sn) kareArtışı=' + frameDelta + ' videoWidth=' + s1.videoWidth + ' currentTimeArtışı=' + timeDelta.toFixed(1) + ' workerİstek=' + counter.workerRequestCount() + ' geçiş=' + switched);
  // Tanılama: pencere içi baytların ana makine + uzantıya göre dökümü.
  const bd1 = counter.breakdown();
  const parts = Object.keys(bd1).map((k) => [k, bd1[k] - (bd0[k] ?? 0)] as const).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  console.log('Kick pencere dökümü: ' + parts.map(([k, v]) => k + '=' + v).join(' | '));
  const q = await page.evaluate(() => {
    const v = document.querySelector('video#video-player') as HTMLVideoElement | null;
    const end = v && v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0;
    return { videos: document.querySelectorAll('video').length, bufferAhead: v ? end - v.currentTime : -1 };
  });
  console.log('Kick sayfa: ' + JSON.stringify(q));
  await counter.stop();

  expect.soft(switched, 'geçiş (videoWidth 0 ve currentTime ilerliyor) 90 sn içinde olmalı').toBe(true);
  expect.soft(winBytes, 'live-video.net 45 sn bayt').toBeLessThan(MAX_WINDOW_BYTES);
  expect.soft(frameDelta, 'pencere içi totalVideoFrames artışı').toBe(EXPECTED_FRAME_DELTA);
  expect.soft(s1.videoWidth, 'videoWidth').toBe(EXPECTED_VIDEO_WIDTH);
  expect.soft(timeDelta, 'pencere içi currentTime artışı').toBeGreaterThanOrEqual(MIN_CURRENT_TIME_DELTA);
  await expect.soft(page.locator('#only-audio-cover[data-mode="audio"]'), 'kapak görünür').toBeVisible({ timeout: 2000 });
});
