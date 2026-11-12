// Faz 4 ölçüm betiği. Playwright test paketine GİRMEZ (testDir: tests). Uzantı koduna dokunmaz.
//
//   node scripts/measure.ts [--sites yt-vod,yt-live,twitch,kick] [--runs 2] [--window 60]
//                           [--warmup 15] [--out <ham-json>] [--report]
//
// Düzenek: Brave Playwright dışında başlatılır, CDP ile bağlanılır (tests/helpers/brave.ts).
// Her koşul: site × uzantı (kapalı/açık) × sekme (görünür/gizli) × tekrar. Uzantı "kapalı" =
// popup'taki ana anahtarın karşılığı olan storage.local.enabled=false (uzantı yüklü, devre dışı).
// Gizleme: DevTools HTTP uç noktası (/json/new, /json/activate/<id>), Playwright odak emülasyonu değil.
// Ölçülemeyen değer null yazılır; rapor bunu "ölçülemedi" olarak gösterir. Tahmin yazılmaz.
import * as fs from 'node:fs';
import * as path from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchBrave, firstPage, countBytes, sleep } from '../tests/helpers/brave.ts';
import type { LaunchedBrave, ByteCounter } from '../tests/helpers/brave.ts';

type Page = Awaited<ReturnType<typeof firstPage>>;
type Site = 'yt-vod' | 'yt-live' | 'twitch' | 'kick';
const ALL_SITES: Site[] = ['yt-vod', 'yt-live', 'twitch', 'kick'];

const ROOT = path.resolve(import.meta.dirname, '..');
const EXTENSION_PATH = path.join(ROOT, 'extension');
const YT_VOD_ID = 'aqz-KE-bpKQ';
const YT_LIVE_URL = 'https://www.youtube.com/@LofiGirl/live';
const BYTE_PATTERN: Record<Site, RegExp> = {
  'yt-vod': /googlevideo\.com/,
  'yt-live': /googlevideo\.com/,
  twitch: /\.ttvnw\.net/,
  kick: /live-video\.net/,
};

function arg(name: string, def: string): string {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const SITES = arg('sites', ALL_SITES.join(',')).split(',') as Site[];
const RUNS = Number(arg('runs', '2'));
let WINDOW_SEC = Number(arg('window', '60'));
const WARMUP_SEC = Number(arg('warmup', '15'));
const ONLY_EXT = arg('ext', 'off,on').split(',');
const ONLY_VIS = arg('vis', 'visible,hidden').split(',');
const OUT = path.resolve(arg('out', path.join(ROOT, 'docs', 'results-raw.json')));
const READY_TIMEOUT_MS = 150_000;

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------
interface UmpSummary {
  requests: number;
  bodiesParsed: number;
  bodiesFailed: number;
  segments: number; // medya segment başlığı (init hariç)
  uniqueSegments: number;
  repeatedSegments: number; // aynı (itag, sıra no) ikinci ve sonraki kez
  repeatedBytes: number; // tekrarların content_length toplamı
  mediaBytes: number; // tüm segmentlerin content_length toplamı
  // yalnız ölçüm penceresi içinde alınan yanıtlar
  winSegments: number;
  winRepeated: number; // pencere içindeki, daha önce (pencere öncesi dahil) görülmüş segmentler
  winRepeatedBytes: number;
  winMediaBytes: number;
  itags: Record<string, number>;
  /** En çok tekrar edilen (itag:sıra:aralık) anahtarları ve sayıları. */
  topRepeats: string[];
}

interface Snap {
  bytes: number;
  frames: number;
  currentTime: number;
  videoWidth: number;
  videoHeight: number;
  jsHeap: number | null;
  procs: { id: number; type: string; cpu: number }[] | null;
}

interface RunRecord {
  site: Site;
  ext: 'off' | 'on';
  vis: 'visible' | 'hidden';
  run: number;
  status: 'ok' | 'hata' | 'ölçülemedi';
  error?: string;
  detail?: string; // kanal vb.
  startedAt: string;
  windowSec?: number;
  kbPerSec?: number;
  frameDelta?: number;
  videoWidthEnd?: number;
  videoHeightEnd?: number;
  timeDelta?: number;
  jsHeapMB?: number | null;
  rendererMB?: number | null; // en büyük renderer (video sekmesi), özel çalışma kümesi
  rendererSumMB?: number | null; // tüm renderer işlemleri
  gpuMB?: number | null;
  totalMB?: number | null; // getProcessInfo'daki tüm işlemler
  rendererCpuPct?: number | null; // tek çekirdek yüzdesi
  gpuCpuPct?: number | null;
  totalCpuPct?: number | null;
  coverMode?: string | null;
  switched?: boolean | null;
  adSamples?: number;
  visibilityState?: string;
  ump?: UmpSummary | null;
  notes: string[];
}

// ---------------------------------------------------------------------------
// DevTools HTTP: yeni sekme / etkinleştirme
// ---------------------------------------------------------------------------
async function devtools(port: number, p: string, method = 'GET'): Promise<any> {
  const res = await fetch('http://127.0.0.1:' + port + p, { method });
  const text = await res.text();
  try { return JSON.parse(text); } catch { return text; }
}

// ---------------------------------------------------------------------------
// Süreç belleği (Windows): özel çalışma kümesi, Görev Yöneticisi'ndeki "Bellek" sütununun karşılığı
// ---------------------------------------------------------------------------
function workingSetPrivate(pids: number[]): Map<number, number> | null {
  if (pids.length === 0) return new Map();
  try {
    const script =
      '$ids=@(' + pids.join(',') + ');' +
      'Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | Where-Object { $ids -contains $_.IDProcess } | ' +
      'Select-Object IDProcess,WorkingSetPrivate | ConvertTo-Json -Compress';
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 30_000 }).trim();
    if (!out) return null;
    const parsed = JSON.parse(out);
    const rows: { IDProcess: number; WorkingSetPrivate: number }[] = Array.isArray(parsed) ? parsed : [parsed];
    const map = new Map<number, number>();
    for (const r of rows) map.set(r.IDProcess, r.WorkingSetPrivate);
    return map;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// UMP yanıt çözümleyici (YouTube canlı: aynı segment tekrar indiriliyor mu?)
// ---------------------------------------------------------------------------
function readUmpVarint(b: Uint8Array, pos: number): { v: number; n: number } | null {
  if (pos >= b.length) return null;
  const f = b[pos];
  let n = 1;
  if (f >= 0xf0) n = 5; else if (f >= 0xe0) n = 4; else if (f >= 0xc0) n = 3; else if (f >= 0x80) n = 2;
  if (pos + n > b.length) return null;
  let v: number;
  if (n === 1) v = f;
  else if (n === 2) v = (f & 0x3f) + 64 * b[pos + 1];
  else if (n === 3) v = (f & 0x1f) + 32 * (b[pos + 1] + 256 * b[pos + 2]);
  else if (n === 4) v = (f & 0x0f) + 16 * (b[pos + 1] + 256 * b[pos + 2] + 65536 * b[pos + 3]);
  else v = b[pos + 1] + 256 * b[pos + 2] + 65536 * b[pos + 3] + 16777216 * b[pos + 4];
  return { v, n };
}

function readPbVarint(b: Uint8Array, pos: number): { v: number; n: number } | null {
  let v = 0, mul = 1, n = 0;
  while (pos + n < b.length) {
    const c = b[pos + n++];
    v += (c & 0x7f) * mul;
    mul *= 128;
    if (!(c & 0x80)) return { v, n };
    if (n > 8) return null;
  }
  return null;
}

/** Düz protobuf: yalnız varint alanlar; 13 (format_id) içindeki itag ayrıca alınır. */
function parsePb(b: Uint8Array): Map<number, number> {
  const out = new Map<number, number>();
  let pos = 0;
  while (pos < b.length) {
    const key = readPbVarint(b, pos);
    if (!key) break;
    pos += key.n;
    const field = Math.floor(key.v / 8), wt = key.v % 8;
    if (wt === 0) {
      const v = readPbVarint(b, pos);
      if (!v) break;
      pos += v.n;
      out.set(field, v.v);
    } else if (wt === 2) {
      const len = readPbVarint(b, pos);
      if (!len) break;
      pos += len.n;
      if (field === 13) {
        const inner = parsePb(b.subarray(pos, pos + len.v));
        if (inner.has(1)) out.set(1300, inner.get(1) as number);
      }
      pos += len.v;
    } else if (wt === 1) pos += 8;
    else if (wt === 5) pos += 4;
    else break;
  }
  return out;
}

interface SegHeader { id: number; itag: number; seq: number; init: boolean; len: number; startMs: number; range: number; durMs: number; t: number }

function parseUmp(buf: Uint8Array, t: number): SegHeader[] | null {
  const heads: SegHeader[] = [];
  const byId = new Map<number, SegHeader>();
  let pos = 0;
  while (pos < buf.length) {
    const type = readUmpVarint(buf, pos);
    if (!type) break;
    pos += type.n;
    const size = readUmpVarint(buf, pos);
    if (!size) break;
    pos += size.n;
    if (pos + size.v > buf.length) break;
    if (type.v === 20) {
      const f = parsePb(buf.subarray(pos, pos + size.v));
      const h: SegHeader = {
        id: f.get(1) ?? -1,
        itag: f.get(3) ?? f.get(1300) ?? 0,
        seq: f.get(9) ?? -1,
        init: f.get(8) === 1,
        len: 0,
        startMs: f.get(11) ?? -1,
        range: f.get(6) ?? 0,
        durMs: f.get(12) ?? 0,
        t,
      };
      heads.push(h);
      byId.set(h.id, h);
    } else if (type.v === 21 && size.v > 1) {
      // MEDIA: ilk bayt header_id, kalanı medya verisi
      const h = byId.get(buf[pos]);
      if (h) h.len += size.v - 1;
    }
    pos += size.v;
  }
  return heads.length > 0 ? heads : null;
}

interface UmpProbe { summary(windowStart: number): UmpSummary; sample(): SegHeader[]; stop(): Promise<void> }

async function startUmpProbe(page: Page): Promise<UmpProbe> {
  const s = await page.context().newCDPSession(page);
  await s.send('Network.enable');
  const reqs = new Map<string, { url: string; t: number }>();
  const heads: SegHeader[] = [];
  let requests = 0, ok = 0, failed = 0;
  const jobs: Promise<void>[] = [];
  s.on('Network.requestWillBeSent', (e: any) => {
    if (/googlevideo\.com\/videoplayback/.test(e.request.url)) { reqs.set(e.requestId, { url: e.request.url, t: Date.now() }); requests++; }
  });
  s.on('Network.loadingFinished', (e: any) => {
    const r = reqs.get(e.requestId);
    if (!r) return;
    jobs.push((async () => {
      try {
        const body = await s.send('Network.getResponseBody', { requestId: e.requestId });
        if (!body.base64Encoded) { failed++; return; }
        const parsed = parseUmp(Buffer.from(body.body, 'base64'), r.t);
        if (parsed) { ok++; heads.push(...parsed); } else failed++;
      } catch { failed++; }
    })());
  });
  return {
    sample: () => heads.slice(0, 12),
    summary: (windowStart: number) => {
      const seen = new Map<string, number>();
      const sum: UmpSummary = {
        requests, bodiesParsed: ok, bodiesFailed: failed, segments: 0, uniqueSegments: 0, repeatedSegments: 0, repeatedBytes: 0,
        mediaBytes: 0, winSegments: 0, winRepeated: 0, winRepeatedBytes: 0, winMediaBytes: 0, itags: {}, topRepeats: [],
      };
      for (const h of heads.slice().sort((a, b) => a.t - b.t)) {
        if (h.init || h.seq < 0) continue;
        const key = h.itag + ':' + h.seq + ':' + h.range;
        const dup = seen.has(key);
        seen.set(key, (seen.get(key) ?? 0) + 1);
        sum.segments++;
        sum.mediaBytes += h.len;
        sum.itags[String(h.itag)] = (sum.itags[String(h.itag)] ?? 0) + 1;
        if (dup) { sum.repeatedSegments++; sum.repeatedBytes += h.len; }
        if (h.t >= windowStart) {
          sum.winSegments++;
          sum.winMediaBytes += h.len;
          if (dup) { sum.winRepeated++; sum.winRepeatedBytes += h.len; }
        }
      }
      sum.uniqueSegments = seen.size;
      sum.topRepeats = [...seen.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, n]) => k + ' x' + n);
      return sum;
    },
    stop: async () => { await Promise.allSettled(jobs); await s.detach().catch(() => undefined); },
  };
}

// ---------------------------------------------------------------------------
// Sayfa yardımcıları
// ---------------------------------------------------------------------------
interface VStat { found: boolean; frames: number; width: number; height: number; time: number; paused: boolean; ready: number }

async function vstat(page: Page, kick: boolean): Promise<VStat> {
  return page.evaluate((isKick) => {
    const vids = Array.from(document.querySelectorAll('video')) as HTMLVideoElement[];
    const v = isKick ? (document.querySelector('video#video-player') as HTMLVideoElement | null) : vids.sort((a, b) => b.currentTime - a.currentTime)[0];
    if (!v) return { found: false, frames: 0, width: 0, height: 0, time: 0, paused: true, ready: 0 };
    const q = v.getVideoPlaybackQuality ? v.getVideoPlaybackQuality() : { totalVideoFrames: 0 };
    return { found: true, frames: q.totalVideoFrames, width: v.videoWidth, height: v.videoHeight, time: v.currentTime, paused: v.paused, ready: v.readyState };
  }, kick).catch(() => ({ found: false, frames: 0, width: 0, height: 0, time: 0, paused: true, ready: 0 }));
}

async function clickAny(page: Page, selectors: string[]): Promise<boolean> {
  return page.evaluate((sels) => {
    for (const s of sels) {
      const el = document.querySelector(s) as HTMLElement | null;
      if (el && el.offsetParent !== null) { el.click(); return true; }
    }
    return false;
  }, selectors).catch(() => false);
}

async function ytAdActive(page: Page): Promise<boolean> {
  await clickAny(page, ['.ytp-skip-ad-button', '.ytp-ad-skip-button', '.ytp-ad-skip-button-modern']);
  return page.evaluate(() => !!document.querySelector('#movie_player.ad-showing')).catch(() => false);
}

async function twitchAdActive(page: Page): Promise<boolean> {
  return page.evaluate(() => !!document.querySelector('[data-a-target="video-ad-label"], [data-test-selector="ad-banner-default-text"]')).catch(() => false);
}

async function dismissBlockers(page: Page, site: Site): Promise<void> {
  const common = ['#onetrust-reject-all-handler', '#onetrust-accept-btn-handler'];
  const per: Record<Site, string[]> = {
    'yt-vod': ['button[aria-label*="Accept all" i]', 'button[aria-label*="Tümünü kabul" i]', 'form[action*="consent"] button'],
    'yt-live': ['button[aria-label*="Accept all" i]', 'button[aria-label*="Tümünü kabul" i]', 'form[action*="consent"] button'],
    twitch: ['button[data-a-target="consent-banner-accept"]', 'button[data-a-target="content-classification-gate-overlay-start-watching-button"]', 'button[data-a-target="player-overlay-mature-accept"]'],
    kick: [...common],
  };
  await clickAny(page, per[site]);
}

async function resolveChannels(): Promise<{ twitch?: string; kick?: string; kickBlocked?: string }> {
  const out: { twitch?: string; kick?: string; kickBlocked?: string } = {};
  if (!SITES.includes('twitch') && !SITES.includes('kick')) return out;
  const brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  try {
    const page = await firstPage(brave.context);
    if (SITES.includes('twitch')) {
      if (process.env.TWITCH_CHANNEL) out.twitch = process.env.TWITCH_CHANNEL;
      else {
        await page.goto('https://www.twitch.tv/directory/all?sort=VIEWER_COUNT', { waitUntil: 'domcontentloaded' });
        for (let i = 0; i < 30 && !out.twitch; i++) {
          await dismissBlockers(page, 'twitch');
          const href = await page.evaluate(() => (document.querySelector('a[data-a-target="preview-card-image-link"]') as HTMLAnchorElement | null)?.getAttribute('href') ?? null).catch(() => null);
          if (href && /^\/[A-Za-z0-9_]+\/?$/.test(href)) out.twitch = href.replace(/\//g, '');
          else await sleep(1000);
        }
      }
    }
    if (SITES.includes('kick')) {
      if (process.env.KICK_CHANNEL) out.kick = process.env.KICK_CHANNEL;
      else {
        const resp = await page.goto('https://kick.com/browse', { waitUntil: 'domcontentloaded' });
        const mitigated = resp?.headers()['cf-mitigated'];
        const title = await page.title().catch(() => '');
        if (mitigated || /just a moment|attention required/i.test(title)) out.kickBlocked = mitigated ? 'cf-mitigated: ' + mitigated : 'sayfa başlığı "' + title + '"';
        else {
          for (let i = 0; i < 30 && !out.kick; i++) {
            await dismissBlockers(page, 'kick');
            const hrefs: string[] = await page.evaluate(() => {
              const r: string[] = [];
              for (const img of Array.from(document.querySelectorAll('a[href] img'))) {
                const h = (img.closest('a') as HTMLAnchorElement).getAttribute('href') || '';
                if (/^\/[A-Za-z0-9_-]+\/?$/.test(h) && !r.includes(h)) r.push(h);
              }
              return r;
            }).catch(() => []);
            const reserved = new Set(['browse', 'categories', 'following', 'clips', 'search']);
            const c = hrefs.map((h) => h.replace(/\//g, '')).filter((x) => !reserved.has(x.toLowerCase()));
            if (c.length) out.kick = c[0]; else await sleep(1000);
          }
        }
      }
    }
  } finally {
    await brave.close();
  }
  return out;
}

// ---------------------------------------------------------------------------
// Tek koşu
// ---------------------------------------------------------------------------
async function takeSnap(page: Page, kick: boolean, counter: ByteCounter, perf: any, browserSession: any): Promise<Snap> {
  const v = await vstat(page, kick);
  let jsHeap: number | null = null;
  try {
    const m = await perf.send('Performance.getMetrics');
    const h = (m.metrics as { name: string; value: number }[]).find((x) => x.name === 'JSHeapUsedSize');
    jsHeap = h ? h.value : null;
  } catch { /* ölçülemedi */ }
  let procs: Snap['procs'] = null;
  try {
    const r = await browserSession.send('SystemInfo.getProcessInfo');
    procs = (r.processInfo as { type: string; id: number; cpuTime: number }[]).map((p) => ({ id: p.id, type: String(p.type).toLowerCase(), cpu: p.cpuTime }));
  } catch { /* ölçülemedi */ }
  return { bytes: counter.bytes(), frames: v.frames, currentTime: v.time, videoWidth: v.width, videoHeight: v.height, jsHeap, procs };
}

async function runOne(site: Site, ext: 'off' | 'on', vis: 'visible' | 'hidden', run: number, channels: { twitch?: string; kick?: string; kickBlocked?: string }): Promise<RunRecord> {
  const rec: RunRecord = { site, ext, vis, run, status: 'ok', startedAt: new Date().toISOString(), notes: [] };
  const kick = site === 'kick';
  let brave: LaunchedBrave | undefined;
  let counter: ByteCounter | undefined;
  let probe: UmpProbe | undefined;
  try {
    if (site === 'kick' && !channels.kick) throw new Error('Kick kanalı bulunamadı' + (channels.kickBlocked ? ' (bot kontrolü: ' + channels.kickBlocked + ')' : ''));
    if (site === 'twitch' && !channels.twitch) throw new Error('Twitch kanalı bulunamadı');
    brave = await launchBrave({ extensionPath: EXTENSION_PATH });
    const page = await firstPage(brave.context);

    if (ext === 'off') {
      const popup = await brave.context.newPage();
      await popup.goto('chrome-extension://' + brave.extensionId + '/popup/popup.html');
      await popup.evaluate(() => (globalThis as any).chrome.storage.local.set({ enabled: false }));
      await sleep(1500);
      await popup.close();
    }

    // Hedef sekmenin kimliği; gizleme için engelleyici sekme (DevTools HTTP).
    const ti = await page.context().newCDPSession(page);
    const targetId: string = ((await ti.send('Target.getTargetInfo')) as any).targetInfo.targetId;
    await ti.detach().catch(() => undefined);
    const blocker = await devtools(brave.port, '/json/new?about:blank', 'PUT');
    const blockerId: string = blocker.id;
    await devtools(brave.port, '/json/activate/' + targetId);

    const perf = await page.context().newCDPSession(page);
    await perf.send('Performance.enable');
    const browserSession = await brave.browser.newBrowserCDPSession();

    counter = await countBytes(page, BYTE_PATTERN[site]);
    if (site === 'yt-live') probe = await startUmpProbe(page);

    // --- gezin ---
    if (site === 'yt-vod') await page.goto('https://www.youtube.com/watch?v=' + YT_VOD_ID, { waitUntil: 'domcontentloaded' });
    else if (site === 'yt-live') await page.goto(YT_LIVE_URL, { waitUntil: 'domcontentloaded' });
    else if (site === 'twitch') { await page.goto('https://www.twitch.tv/' + channels.twitch, { waitUntil: 'domcontentloaded' }); rec.detail = 'kanal ' + channels.twitch; }
    else {
      const resp = await page.goto('https://kick.com/' + channels.kick, { waitUntil: 'domcontentloaded' });
      rec.detail = 'kanal ' + channels.kick;
      const mitigated = resp?.headers()['cf-mitigated'];
      if (mitigated) throw new Error('Kick bot kontrolü (cf-mitigated: ' + mitigated + ')');
    }

    // --- hazır olana dek bekle ---
    const t0 = Date.now();
    let ready = false;
    let lastTime = -1;
    let switched: boolean | null = ext === 'on' && site !== 'yt-vod' && site !== 'yt-live' ? false : null;
    while (Date.now() - t0 < READY_TIMEOUT_MS) {
      await dismissBlockers(page, site);
      const isAd = site === 'twitch' ? await twitchAdActive(page) : site.startsWith('yt') ? await ytAdActive(page) : false;
      const s = await vstat(page, kick);
      if (s.found && s.paused) await page.evaluate((isKick) => { const v = (isKick ? document.querySelector('video#video-player') : document.querySelector('video')) as HTMLVideoElement | null; if (v) void v.play().catch(() => undefined); }, kick).catch(() => undefined);
      const advancing = s.found && !s.paused && s.time > lastTime + 0.5 && s.time > 2;
      if (s.found) lastTime = s.time;
      if (!isAd && advancing) {
        if (site === 'yt-live' && ext === 'on') {
          const live = await page.locator('#only-audio-cover[data-reason="live"]').count().catch(() => 0);
          if (live > 0 && s.ready >= 3) ready = true;
        } else if (ext === 'on') {
          // Yalnız ses geçişi: videoWidth 0 olmalı (YouTube VOD'da kapak data-mode=audio)
          if (s.width === 0) { ready = true; switched = true; }
        } else if (s.width > 0 && s.ready >= 3) ready = true;
      }
      if (ready) break;
      await sleep(2000);
    }
    if (!ready) {
      const s = await vstat(page, kick);
      rec.notes.push('hazır olmadı (150 sn): ' + JSON.stringify(s));
      if (ext === 'on' && switched === false) rec.notes.push('yalnız-ses geçişi gerçekleşmedi; ölçüm mevcut durumda alındı');
      if (!s.found || s.time < 2) throw new Error('oynatma başlamadı');
    }
    rec.switched = switched;

    // --- gizle / ısın ---
    if (vis === 'hidden') await devtools(brave.port, '/json/activate/' + blockerId);
    else await devtools(brave.port, '/json/activate/' + targetId);
    const warmEnd = Date.now() + WARMUP_SEC * 1000;
    let adSamples = 0;
    const adCheck = async (): Promise<void> => {
      const a = site === 'twitch' ? await twitchAdActive(page) : site.startsWith('yt') ? await ytAdActive(page) : false;
      if (a) adSamples++;
    };
    while (Date.now() < warmEnd) { await adCheck(); await dismissBlockers(page, site); await sleep(2000); }
    adSamples = 0;

    // --- ölçüm penceresi ---
    const startTs = Date.now();
    const a = await takeSnap(page, kick, counter, perf, browserSession);
    const endAt = startTs + WINDOW_SEC * 1000;
    while (Date.now() < endAt - 1500) { await adCheck(); await sleep(2000); }
    while (Date.now() < endAt) await sleep(100);
    const elapsed = (Date.now() - startTs) / 1000;
    const b = await takeSnap(page, kick, counter, perf, browserSession);
    rec.visibilityState = await page.evaluate(() => document.visibilityState).catch(() => 'bilinmiyor');
    rec.coverMode = await page.evaluate(() => document.getElementById('only-audio-cover')?.getAttribute('data-mode') ?? null).catch(() => null);
    rec.adSamples = adSamples;
    rec.windowSec = Math.round(elapsed * 10) / 10;
    rec.kbPerSec = Math.round(((b.bytes - a.bytes) / 1024 / elapsed) * 10) / 10;
    rec.frameDelta = b.frames - a.frames;
    rec.videoWidthEnd = b.videoWidth;
    rec.videoHeightEnd = b.videoHeight;
    rec.timeDelta = Math.round((b.currentTime - a.currentTime) * 10) / 10;
    rec.jsHeapMB = b.jsHeap == null ? null : Math.round((b.jsHeap / 1048576) * 10) / 10;

    // --- süreç belleği / CPU ---
    rec.rendererMB = rec.rendererSumMB = rec.gpuMB = rec.totalMB = null;
    rec.rendererCpuPct = rec.gpuCpuPct = rec.totalCpuPct = null;
    if (a.procs && b.procs) {
      const mem = workingSetPrivate(b.procs.map((p) => p.id));
      const aCpu = new Map(a.procs.map((p) => [p.id, p.cpu]));
      const cpuPct = (ps: typeof b.procs): number | null => {
        if (!ps || ps.length === 0) return null;
        let sum = 0;
        for (const p of ps) { const before = aCpu.get(p.id); if (before === undefined) return null; sum += p.cpu - before; }
        return Math.round((sum / elapsed) * 1000) / 10;
      };
      const renderers = b.procs.filter((p) => p.type === 'renderer');
      const gpu = b.procs.filter((p) => p.type === 'gpu');
      rec.totalCpuPct = cpuPct(b.procs);
      rec.gpuCpuPct = cpuPct(gpu);
      if (mem && mem.size > 0) {
        const mb = (n: number): number => Math.round((n / 1048576) * 10) / 10;
        const rm = renderers.filter((p) => mem.has(p.id)).sort((x, y) => (mem.get(y.id) as number) - (mem.get(x.id) as number));
        if (rm.length) {
          rec.rendererMB = mb(mem.get(rm[0].id) as number);
          rec.rendererSumMB = mb(rm.reduce((s, p) => s + (mem.get(p.id) as number), 0));
          rec.rendererCpuPct = cpuPct([rm[0]]);
        }
        const gm = gpu.filter((p) => mem.has(p.id));
        if (gm.length) rec.gpuMB = mb(gm.reduce((s, p) => s + (mem.get(p.id) as number), 0));
        rec.totalMB = mb(b.procs.filter((p) => mem.has(p.id)).reduce((s, p) => s + (mem.get(p.id) as number), 0));
      } else rec.notes.push('süreç belleği okunamadı (Win32_PerfFormattedData)');
    } else rec.notes.push('SystemInfo.getProcessInfo kullanılamadı');

    if (probe) {
      await probe.stop();
      rec.ump = probe.summary(startTs);
      if (rec.ump.bodiesParsed === 0) { rec.notes.push('UMP yanıtları çözülemedi'); rec.ump = null; }
      else if (run === 1 && vis === 'visible') rec.notes.push('UMP örnek başlıklar: ' + JSON.stringify(probe.sample().slice(0, 6)));
      probe = undefined;
    }
    if (site.startsWith('yt') && adSamples > 0) rec.notes.push('pencerede reklam görüldü (' + adSamples + ' örnek)');
    if (site === 'twitch' && adSamples > 0) rec.notes.push('pencerede reklam görüldü (' + adSamples + ' örnek)');
    if (ext === 'off' && vis === 'hidden' && (rec.frameDelta ?? 0) > WINDOW_SEC * 5) rec.notes.push('sekme gizlendi denmesine rağmen kare akıyor: gizleme etkisiz');
    if (ext === 'on' && rec.frameDelta !== 0) rec.notes.push('uzantı açık ama kare artışı ' + rec.frameDelta);
    if (ext === 'off' && rec.frameDelta === 0 && vis === 'visible') rec.notes.push('uzantı kapalı ama kare artmadı');
  } catch (e) {
    rec.status = 'hata';
    rec.error = e instanceof Error ? e.message : String(e);
  } finally {
    try { if (probe) await probe.stop(); } catch { /* yoksay */ }
    try { if (counter) await counter.stop(); } catch { /* yoksay */ }
    if (brave) await brave.close();
  }
  return rec;
}

// ---------------------------------------------------------------------------
// Rapor
// ---------------------------------------------------------------------------
const NA = 'ölçülemedi';
const f = (v: number | null | undefined, d = 1): string => (v == null ? NA : v.toFixed(d));

function render(records: RunRecord[]): string {
  const siteName: Record<Site, string> = { 'yt-vod': 'YouTube VOD', 'yt-live': 'YouTube canlı', twitch: 'Twitch canlı', kick: 'Kick canlı' };
  const lines: string[] = [];
  for (const site of ALL_SITES) {
    const rs = records.filter((r) => r.site === site && r.run > 0);
    if (rs.length === 0) continue;
    const detail = rs.find((r) => r.detail)?.detail;
    lines.push('### ' + siteName[site] + (detail ? ' (' + detail + ')' : ''), '');
    lines.push('| Uzantı | Sekme | Tekrar | KB/sn | Kare (pencere) | videoWidth | Δ currentTime | JS yığını MB | Renderer MB | GPU MB | Toplam MB | Renderer CPU % | GPU CPU % | Not |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    const order = (r: RunRecord): string => r.ext + r.vis + String(r.run);
    for (const r of rs.slice().sort((x, y) => order(x).localeCompare(order(y)))) {
      if (r.status !== 'ok') {
        lines.push('| ' + r.ext + ' | ' + r.vis + ' | ' + r.run + ' | ' + Array(10).fill(NA).join(' | ') + ' | ' + (r.status === 'hata' ? 'HATA: ' : '') + (r.error ?? '').replace(/\|/g, '/') + ' |');
        continue;
      }
      const notes = r.notes.filter((n) => !n.startsWith('UMP örnek')).join('; ').replace(/\|/g, '/');
      lines.push('| ' + [r.ext, r.vis, r.run, f(r.kbPerSec), r.frameDelta ?? NA, r.videoWidthEnd ?? NA, f(r.timeDelta), f(r.jsHeapMB), f(r.rendererMB), f(r.gpuMB), f(r.totalMB), f(r.rendererCpuPct), f(r.gpuCpuPct), notes || '-'].join(' | ') + ' |');
    }
    lines.push('');
  }
  const pf = records.find((r) => r.run === 0);
  if (pf) {
    lines.push('### Gizleme ön denetimi', '');
    lines.push(pf.status === 'ok' ? 'YouTube VOD, uzantı kapalı, sekme gizlendikten ' + WARMUP_SEC + ' sn sonra ' + pf.windowSec + ' sn pencerede çözülen kare: **' + pf.frameDelta + '** (visibilityState=' + pf.visibilityState + '). Gizli sekmede çözme ~10 sn sonra durmalıydı.' : 'Ön denetim çalışmadı: ' + pf.error);
    lines.push('');
  }
  // Canlı: segment tekrarı
  const live = records.filter((r) => r.site === 'yt-live' && r.status === 'ok' && r.run > 0);
  if (live.length) {
    lines.push('### YouTube canlı: segment tekrar sayımı (UMP MEDIA_HEADER, (itag, sıra no) çifti)', '');
    lines.push('| Uzantı | Sekme | Tekrar | İstek | Çözülen yanıt | Segment | Benzersiz | Tekrar eden | Tekrar baytı KB | Toplam medya KB | Pencere: segment | Pencere: tekrar | Pencere: tekrar KB |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
    for (const r of live.slice().sort((x, y) => (x.ext + x.vis + x.run).localeCompare(y.ext + y.vis + y.run))) {
      const u = r.ump;
      if (!u) { lines.push('| ' + r.ext + ' | ' + r.vis + ' | ' + r.run + ' | ' + Array(10).fill(NA).join(' | ') + ' |'); continue; }
      const kb = (n: number): string => (n / 1024).toFixed(0);
      lines.push('| ' + [r.ext, r.vis, r.run, u.requests, u.bodiesParsed + '/' + (u.bodiesParsed + u.bodiesFailed), u.segments, u.uniqueSegments, u.repeatedSegments, kb(u.repeatedBytes), kb(u.mediaBytes), u.winSegments, u.winRepeated, kb(u.winRepeatedBytes)].join(' | ') + ' |');
    }
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Ana akış
// ---------------------------------------------------------------------------
function load(): RunRecord[] {
  try { return JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { return []; }
}

async function main(): Promise<void> {
  if (process.argv.includes('--report')) {
    const out = path.join(ROOT, 'docs', 'results-tables.md');
    fs.writeFileSync(out, render(load()));
    console.log('yazıldı: ' + out);
    return;
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const records = load();
  const channels = await resolveChannels();
  console.log('kanallar: ' + JSON.stringify(channels));
  // Gizleme ön denetimi: uzantısız YouTube VOD'u gizle; ısınmadan sonra kare hâlâ akıyorsa sekme gerçekten gizlenmemiştir.
  let hideWorks = true;
  let hideNote = '';
  if (ONLY_VIS.includes('hidden')) {
    const saved = WINDOW_SEC;
    WINDOW_SEC = 15;
    console.log('gizleme ön denetimi (yt-vod, uzantı kapalı, 15 sn pencere)');
    const pf = await runOne('yt-vod', 'off', 'hidden', 0, channels);
    WINDOW_SEC = saved;
    const i0 = records.findIndex((r) => r.run === 0);
    if (i0 >= 0) records[i0] = pf; else records.push(pf);
    if (pf.status === 'ok' && (pf.frameDelta ?? 0) > 30) {
      hideWorks = false;
      hideNote = 'sekme gizlenemedi: DevTools /json/new + /json/activate sonrası ' + (WARMUP_SEC) + ' sn ısınmadan sonra 15 sn pencerede ' + pf.frameDelta + ' kare çözüldü (visibilityState=' + pf.visibilityState + '); gizliyken çözme durmalıydı';
    } else if (pf.status !== 'ok') {
      hideWorks = false;
      hideNote = 'gizleme ön denetimi çalışmadı: ' + pf.error;
    }
    console.log('  gizleme etkili mi: ' + hideWorks + ' (kare=' + pf.frameDelta + ', visibilityState=' + pf.visibilityState + ')');
    fs.writeFileSync(OUT, JSON.stringify(records, null, 1));
  }
  for (let run = 1; run <= RUNS; run++) {
    for (const site of SITES) {
      for (const ext of (['off', 'on'] as const).filter((x) => ONLY_EXT.includes(x))) {
        for (const vis of (['visible', 'hidden'] as const).filter((x) => ONLY_VIS.includes(x))) {
          if (records.some((r) => r.site === site && r.ext === ext && r.vis === vis && r.run === run && (r.status === 'ok' || r.status === 'ölçülemedi'))) continue;
          if (vis === 'hidden' && !hideWorks) {
            const skip: RunRecord = { site, ext, vis, run, status: 'ölçülemedi', error: hideNote, startedAt: new Date().toISOString(), notes: [] };
            const k = records.findIndex((r) => r.site === site && r.ext === ext && r.vis === vis && r.run === run);
            if (k >= 0) records[k] = skip; else records.push(skip);
            fs.writeFileSync(OUT, JSON.stringify(records, null, 1));
            continue;
          }
          const label = site + ' ext=' + ext + ' ' + vis + ' #' + run;
          console.log('[' + new Date().toLocaleTimeString() + '] ' + label);
          let rec = await runOne(site, ext, vis, run, channels);
          if (rec.status !== 'ok') {
            console.log('  hata: ' + rec.error + ' → bir kez daha deneniyor');
            rec = await runOne(site, ext, vis, run, channels);
          }
          console.log('  ' + (rec.status === 'ok' ? 'KB/sn=' + rec.kbPerSec + ' kare=' + rec.frameDelta + ' w=' + rec.videoWidthEnd + ' renderer=' + rec.rendererMB + 'MB cpu=' + rec.rendererCpuPct + '% ' + rec.notes.filter((n) => !n.startsWith('UMP örnek')).join('; ') : 'HATA: ' + rec.error));
          const i = records.findIndex((r) => r.site === site && r.ext === ext && r.vis === vis && r.run === run);
          if (i >= 0) records[i] = rec; else records.push(rec);
          fs.writeFileSync(OUT, JSON.stringify(records, null, 1));
        }
      }
    }
  }
  fs.writeFileSync(path.join(ROOT, 'docs', 'results-tables.md'), render(records));
  console.log('bitti');
}

main().catch((e) => { console.error(e); process.exit(1); });
