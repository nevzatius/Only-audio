import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchBrave, firstPage, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { videoStats } from './helpers/sites';

// Genel adaptör (docs/plan-faz3.md): yerel fixture'da site eklenince kapak görünür, kaldırılınca kaybolur.
//
// İzin istemi notu: chrome.permissions.request yerel bir tarayıcı istemi açar ve CDP ile
// tıklanamaz. Bu yüzden uzantı geçici bir kopyadan yüklenir; kopyanın manifest'ine yalnızca
// 127.0.0.1 host izni eklenir. "Ekle/kaldır" ayarı storage.local üzerinden yazılır (popup'un
// yazdığı alanın aynısı). Service worker kaydı, köprü, kapak ve geri alma gerçek akışla sınanır.
// Popup'taki izin istemi akışı bu testte DOĞRULANMAZ (bkz. docs/plan-faz3.md).

const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures', 'generic.html');
const PATTERN = '*://127.0.0.1/*';
const COVER = '#only-audio-cover[data-site="generic"]';

let brave: LaunchedBrave | undefined;
let server: http.Server | undefined;
let extDir = '';

// Uzantının geçici kopyası: _metadata hariç (tarayıcı üretir), manifest'e 127.0.0.1 izni eklenir.
function makeTestExtension(): string {
  const root = path.join(os.tmpdir(), 'only-audio-profiles');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'ext-'));
  fs.cpSync(EXTENSION_PATH, dir, { recursive: true, filter: (src) => path.basename(src) !== '_metadata' });
  const mf = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
  manifest.host_permissions.push(PATTERN);
  fs.writeFileSync(mf, JSON.stringify(manifest, null, 2));
  return dir;
}

function startServer(): Promise<string> {
  return new Promise((resolve) => {
    server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(FIXTURE_PATH));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve('http://127.0.0.1:' + port + '/');
    });
  });
}

test.afterEach(async () => {
  if (brave) await brave.close();
  brave = undefined;
  if (server) await new Promise<void>((r) => server!.close(() => r()));
  server = undefined;
  if (extDir) fs.rmSync(extDir, { recursive: true, force: true });
  extDir = '';
});

async function setup(): Promise<{ page: Page; ext: Page; url: string }> {
  extDir = makeTestExtension();
  const url = await startServer();
  brave = await launchBrave({ extensionPath: extDir });
  const ext = await brave.context.newPage();
  await ext.goto('chrome-extension://' + brave.extensionId + '/popup/popup.html');
  const page = await brave.context.newPage();
  return { page, ext, url };
}

async function setCustomSites(ext: Page, list: string[]): Promise<void> {
  await ext.evaluate((customSites) => (globalThis as any).chrome.storage.local.set({ customSites }), list);
}

// Service worker kaydı eşzamansız: kayıtlı genel betik sayısını bekle (ekleyince 2, kaldırınca 0).
async function waitRegistered(ext: Page, count: number): Promise<void> {
  await expect
    .poll(
      () =>
        ext.evaluate(async () => {
          const l = await (globalThis as any).chrome.scripting.getRegisteredContentScripts();
          return l.filter((s: any) => String(s.id).startsWith('oa-generic-')).length;
        }),
      { message: 'kayıtlı genel betik sayısı', timeout: 10_000 },
    )
    .toBe(count);
}

const videoVisibility = (page: Page): Promise<string> =>
  page.evaluate(() => getComputedStyle(document.querySelector('video') as HTMLVideoElement).visibility);

async function waitPlaying(page: Page): Promise<void> {
  await expect
    .poll(async () => (await videoStats(page)).currentTime, { message: 'video oynamalı', timeout: 15_000 })
    .toBeGreaterThan(0.5);
}

test('genel adaptör: site eklenince kapak görünür, kaldırılınca kaybolur', async () => {
  const { page, ext, url } = await setup();

  // 1) Site eklenmeden: video oynuyor, kapak yok.
  await page.goto(url);
  await waitPlaying(page);
  await sleep(2500);
  await expect(page.locator(COVER), 'eklenmeden kapak olmamalı').toHaveCount(0);
  expect(await videoVisibility(page), 'eklenmeden video görünür').toBe('visible');

  // 2) Site ekle, sayfayı yenile: kapak görünür, video gizli, kapsayıcı işaretli.
  await setCustomSites(ext, [PATTERN]);
  await waitRegistered(ext, 2);
  await page.reload();
  await expect(page.locator(COVER), 'eklenince kapak görünmeli').toBeVisible({ timeout: 15_000 });
  await expect(page.locator(COVER)).toHaveAttribute('data-mode', 'audio');
  expect(await videoVisibility(page), 'eklenince video gizli').toBe('hidden');
  await expect(page.locator('#player[data-only-audio-player]'), 'kapsayıcı işaretli').toHaveCount(1);
  const s = await videoStats(page);
  expect(s.found).toBe(true);
  expect(s.currentTime, 'gizli video yine de oynamaya devam eder (genel adaptör durdurmaz)').toBeGreaterThan(0);

  // 3) Site kaldır (yenilemeden): kapak kaybolur, video geri gelir, kayıtlar silinir.
  await setCustomSites(ext, []);
  await expect(page.locator(COVER), 'kaldırılınca kapak kaybolmalı').toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => videoVisibility(page), { message: 'video geri görünür', timeout: 5000 }).toBe('visible');
  await expect(page.locator('#player[data-only-audio-player]'), 'kapsayıcı işareti kalkmalı').toHaveCount(0);
  await waitRegistered(ext, 0);

  // 4) Yenileyince de kapak yok (kayıt gerçekten silindi).
  await page.reload();
  await waitPlaying(page);
  await sleep(2500);
  await expect(page.locator(COVER)).toHaveCount(0);
  expect(await videoVisibility(page)).toBe('visible');
});

test('genel adaptör: "Videoya dön" kapağı kaldırır ve videoyu geri getirir', async () => {
  const { page, ext, url } = await setup();
  await setCustomSites(ext, [PATTERN]);
  await waitRegistered(ext, 2);
  await page.goto(url);
  await expect(page.locator(COVER)).toBeVisible({ timeout: 15_000 });

  await page.locator('#only-audio-restore').click();
  await expect(page.locator(COVER), '"Videoya dön" sonrası kapak kalkmalı').toHaveCount(0, { timeout: 5000 });
  await expect.poll(() => videoVisibility(page), { timeout: 5000 }).toBe('visible');
});

test('genel adaptör: uzantı ana anahtarı kapatılınca kapak kaybolur', async () => {
  const { page, ext, url } = await setup();
  await setCustomSites(ext, [PATTERN]);
  await waitRegistered(ext, 2);
  await page.goto(url);
  await expect(page.locator(COVER)).toBeVisible({ timeout: 15_000 });

  await ext.evaluate(() => (globalThis as any).chrome.storage.local.set({ enabled: false }));
  await expect(page.locator(COVER)).toHaveCount(0, { timeout: 10_000 });
  await expect.poll(() => videoVisibility(page), { timeout: 5000 }).toBe('visible');
  await waitRegistered(ext, 0);
});

test('popup: özel site listelenir, ana ayar değişimi customSites\'ı silmez, "Kaldır" siler', async () => {
  const { ext } = await setup();
  await setCustomSites(ext, [PATTERN]);
  await ext.reload();

  await expect(ext.locator('#custom-list li'), 'özel site listelenmeli').toHaveCount(1);
  await expect(ext.locator('#custom-list li')).toContainText('127.0.0.1');
  // Aktif sekme eklenebilir bir http(s) sayfası değil (uzantı sayfası): ekle/kaldır düğmesi kapalı.
  await expect(ext.locator('#toggle-site')).toBeDisabled();

  const read = (): Promise<string[]> =>
    ext.evaluate(async () => ((await (globalThis as any).chrome.storage.local.get('customSites')).customSites ?? []) as string[]);

  await ext.locator('#toggle-youtube').uncheck();
  await expect.poll(() => ext.evaluate(async () => (await (globalThis as any).chrome.storage.local.get('sites')).sites?.youtube)).toBe(false);
  expect(await read(), 'site anahtarı değişimi customSites\'ı silmemeli').toEqual([PATTERN]);

  await ext.locator('#custom-list button').click();
  await expect.poll(read, { message: '"Kaldır" sonrası customSites boş' }).toEqual([]);
  await expect(ext.locator('#custom-list li')).toHaveCount(0);
});
