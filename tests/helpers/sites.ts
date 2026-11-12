import type { Page } from '@playwright/test';
import { sleep } from './brave';

export interface VideoStats {
  found: boolean;
  totalVideoFrames: number;
  videoWidth: number;
  currentTime: number;
  paused: boolean;
  readyState: number;
}

/** Sayfadan bağımsız ölçüm: doğrudan <video> öğesi (uzantı durum mesajına güvenilmez). */
export async function videoStats(page: Page): Promise<VideoStats> {
  return page.evaluate(() => {
    const vids = Array.from(document.querySelectorAll('video'));
    // Birden çok video varsa en çok ilerleyen/oynayan olan
    const v = vids.sort((a, b) => b.currentTime - a.currentTime)[0];
    if (!v) return { found: false, totalVideoFrames: 0, videoWidth: 0, currentTime: 0, paused: true, readyState: 0 };
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : { totalVideoFrames: 0 };
    return {
      found: true,
      totalVideoFrames: q.totalVideoFrames,
      videoWidth: v.videoWidth,
      currentTime: v.currentTime,
      paused: v.paused,
      readyState: v.readyState,
    };
  });
}

async function clickIfPresent(page: Page, selector: string): Promise<boolean> {
  try {
    const el = page.locator(selector).first();
    if (await el.isVisible({ timeout: 200 })) {
      await el.click({ timeout: 1500 });
      return true;
    }
  } catch {
    // yok sayılır
  }
  return false;
}

/** YouTube çerez onayı (AB/ilk ziyaret). Sessizce geçer. */
export async function dismissYoutubeConsent(page: Page): Promise<void> {
  const sels = [
    'button[aria-label*="Accept all" i]',
    'button[aria-label*="Tümünü kabul" i]',
    'tp-yt-paper-dialog button:has-text("Accept all")',
    'ytd-consent-bump-v2-lightbox button:has-text("Accept all")',
    'form[action*="consent"] button:has-text("Accept all")',
  ];
  for (const s of sels) {
    if (await clickIfPresent(page, s)) return;
  }
}

/** Twitch çerez bandı, yetişkin içerik kapısı ve benzeri engelleri kapatır. */
export async function dismissTwitchBlockers(page: Page): Promise<void> {
  const sels = [
    'button[data-a-target="consent-banner-accept"]',
    'button[data-a-target="content-classification-gate-overlay-start-watching-button"]',
    'button[data-a-target="player-overlay-mature-accept"]',
    'button:has-text("Start Watching")',
    'button[aria-label="Close"][data-a-target="tw-core-button-label-text"]',
  ];
  for (const s of sels) await clickIfPresent(page, s);
}

// ---------------------------------------------------------------------------
// Kick
// ---------------------------------------------------------------------------

/** Kick ana oynatıcısı (`video#video-player`); sayfadaki önizleme videoları sayılmaz. */
export async function kickVideoStats(page: Page): Promise<VideoStats> {
  return page.evaluate(() => {
    const v = document.querySelector('video#video-player') as HTMLVideoElement | null;
    if (!v) return { found: false, totalVideoFrames: 0, videoWidth: 0, currentTime: 0, paused: true, readyState: 0 };
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : { totalVideoFrames: 0 };
    return {
      found: true,
      totalVideoFrames: q.totalVideoFrames,
      videoWidth: v.videoWidth,
      currentTime: v.currentTime,
      paused: v.paused,
      readyState: v.readyState,
    };
  });
}

/**
 * Cloudflare/bot kontrolü sayfası mı? Engel varsa gerekçe metni, yoksa null döner.
 * Yalnız algılar; engeli aşmaya çalışmaz (bkz. docs/known-issues.md).
 */
export async function kickBotCheck(page: Page, response: { status(): number; headers(): Record<string, string> } | null): Promise<string | null> {
  if (response) {
    const mitigated = response.headers()['cf-mitigated'];
    if (mitigated) return 'yanıt başlığı cf-mitigated: ' + mitigated + ' (HTTP ' + response.status() + ')';
  }
  // Challenge sayfası birkaç saniye içinde kendini gösterir; kısa süre izle.
  for (let i = 0; i < 4; i++) {
    const hit = await page.evaluate(() => {
      const title = document.title || '';
      if (/just a moment|attention required|bir dakika/i.test(title)) return 'sayfa başlığı "' + title + '"';
      const challenge = document.querySelector('#challenge-form, #challenge-running, #challenge-stage, #cf-challenge-running');
      // Kick uygulaması yüklendiyse (main öğesi) challenge sayfası değildir.
      if (challenge && !document.querySelector('main')) return 'challenge formu (' + (challenge.id || challenge.tagName) + ')';
      return null;
    }).catch(() => null);
    if (hit) return hit;
    await sleep(500);
  }
  return null;
}

/** Kick engelleri: çerez onayı (OneTrust), yetişkin içerik kapısı vb. Sessizce geçer. */
export async function dismissKickBlockers(page: Page): Promise<void> {
  const sels = [
    '#onetrust-reject-all-handler',
    '#onetrust-accept-btn-handler',
    'button:has-text("Start watching")',
    'button:has-text("İzlemeye başla")',
  ];
  for (const s of sels) await clickIfPresent(page, s);
}

export interface KickCandidates {
  channels: string[];
  /** Bot kontrolü görüldüyse gerekçe; aksi halde null. */
  blocked: string | null;
}

/** KICK_CHANNEL ya da kick.com/browse sayfasındaki canlı kanal bağlantıları (en çok 3). */
export async function findKickChannels(page: Page): Promise<KickCandidates> {
  const env = process.env.KICK_CHANNEL;
  if (env) return { channels: [env.replace(/^https?:\/\/(www\.)?kick\.com\//, '').replace(/\/.*$/, '')], blocked: null };
  const resp = await page.goto('https://kick.com/browse', { waitUntil: 'domcontentloaded' });
  const blocked = await kickBotCheck(page, resp);
  if (blocked) return { channels: [], blocked };
  for (let i = 0; i < 30; i++) {
    const hrefs = await page.evaluate(() => {
      const out: string[] = [];
      // Kanal bağlantıları: avatar/küçük resim içeren, tek parçalı yol.
      for (const img of Array.from(document.querySelectorAll('a[href] img'))) {
        const h = (img.closest('a') as HTMLAnchorElement).getAttribute('href') || '';
        if (/^\/[A-Za-z0-9_-]+\/?$/.test(h) && !out.includes(h)) out.push(h);
      }
      return out;
    }).catch(() => [] as string[]);
    const reserved = new Set(['browse', 'categories', 'following', 'clips', 'search']);
    const channels = hrefs.map((h) => h.replace(/\//g, '')).filter((c) => !reserved.has(c.toLowerCase()));
    if (channels.length > 0) return { channels: channels.slice(0, 3), blocked: null };
    await sleep(1000);
  }
  throw new Error('Kick göz atma sayfasında canlı kanal bulunamadı (KICK_CHANNEL ortam değişkeniyle belirtin)');
}

/**
 * Kanalı aç; ana oynatıcı oynamaya başlayana dek bekle (en çok waitMs).
 * Dönen: oynatma başladı mı, bot kontrolü gerekçesi (varsa).
 */
export async function openKickChannel(page: Page, channel: string, waitMs = 30_000): Promise<{ playing: boolean; blocked: string | null }> {
  const resp = await page.goto('https://kick.com/' + channel, { waitUntil: 'domcontentloaded' });
  const blocked = await kickBotCheck(page, resp);
  if (blocked) return { playing: false, blocked };
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    await dismissKickBlockers(page);
    const s = await kickVideoStats(page).catch(() => null);
    if (s && s.found && !s.paused && s.currentTime > 0.5) return { playing: true, blocked: null };
    await sleep(1000);
  }
  return { playing: false, blocked: null };
}

/** YouTube videosunu aç, çerez onayını geç, oynatmayı başlat. Gezinme anını (ms) döndürür. */
export async function openYoutube(page: Page, videoId: string): Promise<number> {
  const t0 = Date.now();
  await page.goto('https://www.youtube.com/watch?v=' + videoId, { waitUntil: 'domcontentloaded' });
  await dismissYoutubeConsent(page);
  // otomatik oynatma bayrağı var; yine de başlamazsa tetikle
  for (let i = 0; i < 10; i++) {
    const s = await videoStats(page).catch(() => null);
    if (s && s.found && !s.paused) break;
    await page.evaluate(() => {
      const v = document.querySelector('video');
      if (v && v.paused) void v.play().catch(() => undefined);
    }).catch(() => undefined);
    await dismissYoutubeConsent(page);
    await sleep(1000);
  }
  return t0;
}

/** TWITCH_CHANNEL ya da kategori sayfasındaki ilk canlı kanal. Kanal adı (küçük harf) döner. */
export async function findTwitchChannel(page: Page): Promise<string> {
  const env = process.env.TWITCH_CHANNEL;
  if (env) return env.replace(/^https?:\/\/www\.twitch\.tv\//, '').replace(/\/.*$/, '');
  await page.goto('https://www.twitch.tv/directory/all?sort=VIEWER_COUNT', { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 30; i++) {
    await dismissTwitchBlockers(page);
    const href = await page.evaluate(() => {
      const a = document.querySelector('a[data-a-target="preview-card-image-link"]') as HTMLAnchorElement | null;
      return a ? a.getAttribute('href') : null;
    });
    if (href && /^\/[A-Za-z0-9_]+\/?$/.test(href)) return href.replace(/\//g, '');
    await sleep(1000);
  }
  throw new Error('Twitch dizininde canlı kanal bulunamadı (TWITCH_CHANNEL ortam değişkeniyle belirtin)');
}

/** Kanalı aç ve engelleri (çerez, yetişkin içerik) kapat. */
export async function openTwitchChannel(page: Page, channel: string): Promise<void> {
  await page.goto('https://www.twitch.tv/' + channel, { waitUntil: 'domcontentloaded' });
  for (let i = 0; i < 6; i++) {
    await dismissTwitchBlockers(page);
    await sleep(500);
  }
}
