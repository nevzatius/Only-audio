import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { launchBrave, firstPage, sleep } from './helpers/brave';
import type { LaunchedBrave } from './helpers/brave';
import { openYoutube, playbackStats, currentVideoId, clickRelatedVod } from './helpers/sites';

// Sekme ses kontrolcüsü (docs/plan-faz5.md). Yerel fixture testleri generic.spec.ts ile aynı düzenekte:
// uzantının geçici kopyasına 127.0.0.1 host izni eklenir (izin istemi CDP ile tıklanamaz); ses betiği
// "eklenen site" yoluyla (storage.local customSites → oa-vol-* kaydı) yüklenir.
// Fixture ses izi olan canlı akış üretir; "sesli sekme" olmaları tab.audible ile beklenir.

const EXTENSION_PATH = path.resolve(__dirname, '..', 'extension');
const FIXTURE_PATH = path.resolve(__dirname, 'fixtures', 'volume.html');
const PATTERN = '*://127.0.0.1/*';
const VOLUME = 0.3;

let brave: LaunchedBrave | undefined;
let server: http.Server | undefined;
let extDir = '';
let port = 0;

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

function startServer(): Promise<void> {
  return new Promise((resolve) => {
    server = http.createServer((_req, res) => {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(fs.readFileSync(FIXTURE_PATH));
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server!.address();
      port = typeof addr === 'object' && addr ? addr.port : 0;
      resolve();
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

async function launch(): Promise<Page> {
  extDir = makeTestExtension();
  await startServer();
  brave = await launchBrave({ extensionPath: extDir, muteAudio: false });
  const ext = await brave.context.newPage();
  await ext.goto('chrome-extension://' + brave.extensionId + '/popup/popup.html');
  return ext;
}

async function addVolumeSite(ext: Page): Promise<void> {
  await ext.evaluate((customSites) => (globalThis as any).chrome.storage.local.set({ customSites }), [PATTERN]);
  await expect
    .poll(
      () =>
        ext.evaluate(async () => {
          const l = await (globalThis as any).chrome.scripting.getRegisteredContentScripts();
          return l.filter((s: any) => String(s.id).startsWith('oa-vol-')).length;
        }),
      { message: 'kayıtlı ses betiği sayısı', timeout: 10_000 },
    )
    .toBe(1);
}

const findTabId = (ext: Page, marker: string): Promise<number> =>
  ext.evaluate(async (m) => {
    const tabs: any[] = await (globalThis as any).chrome.tabs.query({});
    return (tabs.find((t) => String(t.url || '').includes('?t=' + m))?.id ?? -1) as number;
  }, marker);

async function openPage(host: string, marker: string): Promise<Page> {
  const page = await brave!.context.newPage();
  await page.goto('http://' + host + ':' + port + '/?t=' + marker);
  await expect.poll(() => page.evaluate(() => document.querySelector('video')!.currentTime), { timeout: 15_000 }).toBeGreaterThan(0.3);
  return page;
}

/** 127.0.0.1 üzerinde fixture sekmesi açar; sekme kimliğini ve sayfayı döndürür. */
async function openTab(ext: Page, marker: string): Promise<{ page: Page; id: number }> {
  const page = await openPage('127.0.0.1', marker);
  await expect.poll(() => findTabId(ext, marker), { message: 'sekme kimliği (' + marker + ')' }).toBeGreaterThan(-1);
  return { page, id: await findTabId(ext, marker) };
}

const volumeOf = (page: Page, sel = '#v'): Promise<number> =>
  page.evaluate((s) => (document.querySelector(s) as HTMLMediaElement).volume, sel);

async function waitAudible(ext: Page, id: number): Promise<void> {
  await expect
    .poll(() => ext.evaluate(async (i) => (await (globalThis as any).chrome.tabs.get(i)).audible === true, id), {
      message: 'sekme sesli (tab.audible) olmalı',
      timeout: 15_000,
    })
    .toBe(true);
}

const mutedOf = (ext: Page, id: number): Promise<boolean> =>
  ext.evaluate(async (i) => (await (globalThis as any).chrome.tabs.get(i)).mutedInfo.muted === true, id);

/** Popup'ı yeniler (liste yalnız açılışta kurulur). */
async function reopenPopup(ext: Page): Promise<void> {
  await ext.reload();
}

async function setViaMessage(ext: Page, tabId: number, volume: number): Promise<void> {
  await ext.evaluate(({ tabId, volume }) => (globalThis as any).chrome.runtime.sendMessage({ type: 'oa-vol:set', tabId, volume }), { tabId, volume });
}

test('iki sekme: kaydırıcı yalnız hedef sekmenin volume değerini değiştirir', async () => {
  const ext = await launch();
  await addVolumeSite(ext);
  const a = await openTab(ext, 'a');
  const b = await openTab(ext, 'b');
  await waitAudible(ext, a.id);
  await waitAudible(ext, b.id);
  await reopenPopup(ext);

  const rowA = ext.locator('li[data-tab-id="' + a.id + '"]');
  const rowB = ext.locator('li[data-tab-id="' + b.id + '"]');
  await expect(rowA, 'A satırı listelenmeli').toHaveCount(1);
  await expect(rowB, 'B satırı listelenmeli').toHaveCount(1);
  await expect(rowA.locator('input[type="range"]'), 'izinli sitede kaydırıcı etkin').toBeEnabled();

  await rowA.locator('input[type="range"]').fill('30');
  await expect.poll(() => volumeOf(a.page), { message: 'A volume', timeout: 5000 }).toBeCloseTo(VOLUME, 5);
  await sleep(500);
  expect(await volumeOf(b.page), 'B değişmemeli').toBe(1);
  await expect(rowA.locator('.pct')).toHaveText('30%');

  // Değeri atanmış sekme sesli olmasa da (video durdu) listede kalmalı ki sesi geri açılabilsin.
  await rowA.locator('input[type="range"]').fill('0');
  await expect.poll(() => volumeOf(a.page), { message: 'A volume 0' }).toBe(0);
  await a.page.evaluate(() => (document.getElementById('v') as HTMLVideoElement).pause());
  await expect.poll(() => ext.evaluate(async (i) => (await (globalThis as any).chrome.tabs.get(i)).audible, a.id), { message: 'A artık sesli değil', timeout: 15_000 }).toBe(false);
  await reopenPopup(ext);
  await expect(ext.locator('li[data-tab-id="' + a.id + '"]'), '%0 sekme listede kalmalı').toHaveCount(1);
  await expect(ext.locator('li[data-tab-id="' + a.id + '"] input[type="range"]')).toHaveValue('0');
});

test('sessize alma: tabs.update ile sekmeyi susturur ve geri açar', async () => {
  const ext = await launch();
  await addVolumeSite(ext);
  const a = await openTab(ext, 'a');
  const b = await openTab(ext, 'b');
  await waitAudible(ext, a.id);
  await reopenPopup(ext);

  const rowA = ext.locator('li[data-tab-id="' + a.id + '"]');
  await expect(rowA).toHaveCount(1);
  await rowA.locator('.mute').click();
  await expect.poll(() => mutedOf(ext, a.id), { message: 'A susturulmalı' }).toBe(true);
  await expect(rowA).toHaveAttribute('data-muted', 'true');
  expect(await mutedOf(ext, b.id), 'B susturulmamalı').toBe(false);
  expect(await volumeOf(a.page), 'sessize alma öğenin volume değerine dokunmaz').toBe(1);

  // Sessize alınmış sekme, sesli olmasa da listede kalır; yeniden açılışta da.
  await reopenPopup(ext);
  await expect(ext.locator('li[data-tab-id="' + a.id + '"]')).toHaveCount(1);
  await ext.locator('li[data-tab-id="' + a.id + '"] .mute').click();
  await expect.poll(() => mutedOf(ext, a.id)).toBe(false);
});

test('sonradan eklenen video/audio de değeri alır; site geri değiştirirse yeniden uygulanır', async () => {
  const ext = await launch();
  await addVolumeSite(ext);
  const a = await openTab(ext, 'a');
  await setViaMessage(ext, a.id, VOLUME);
  await expect.poll(() => volumeOf(a.page)).toBeCloseTo(VOLUME, 5);

  await a.page.evaluate(() => {
    (window as any).addMedia('video');
    (window as any).addMedia('audio');
  });
  await expect.poll(() => volumeOf(a.page, '#late-video'), { message: 'sonradan eklenen video' }).toBeCloseTo(VOLUME, 5);
  await expect.poll(() => volumeOf(a.page, '#late-audio'), { message: 'sonradan eklenen audio' }).toBeCloseTo(VOLUME, 5);

  // Site kendi sesini geri yazarsa (oynatıcı yenilemesi / SPA) değer yeniden uygulanır.
  await a.page.evaluate(() => {
    (document.getElementById('v') as HTMLVideoElement).volume = 1;
  });
  await expect.poll(() => volumeOf(a.page), { message: 'geri yazılan değer yeniden uygulanmalı' }).toBeCloseTo(VOLUME, 5);

  // %100'e dönünce geçersiz kılma kalkar: site değeri artık serbest.
  await setViaMessage(ext, a.id, 1);
  await a.page.evaluate(() => {
    (document.getElementById('v') as HTMLVideoElement).volume = 0.6;
  });
  await sleep(600);
  expect(await volumeOf(a.page), '%100 sonrası site değeri korunur').toBeCloseTo(0.6, 5);
});

test('kalıcılık: yenileme değeri korur, sekme kapanınca kayıt silinir', async () => {
  const ext = await launch();
  await addVolumeSite(ext);
  const a = await openTab(ext, 'a');
  await setViaMessage(ext, a.id, VOLUME);
  await expect.poll(() => volumeOf(a.page)).toBeCloseTo(VOLUME, 5);

  await a.page.reload();
  await expect.poll(() => volumeOf(a.page), { message: 'yenilemeden sonra değer korunmalı' }).toBeCloseTo(VOLUME, 5);

  const stored = await ext.evaluate((id) => (globalThis as any).chrome.storage.session.get('vol:' + id), a.id);
  expect(stored['vol:' + a.id], 'değer session depolamada').toEqual({ volume: VOLUME });

  await a.page.close();
  await expect
    .poll(() => ext.evaluate(async () => Object.keys(await (globalThis as any).chrome.storage.session.get(null)).filter((k) => k.startsWith('vol:')).length), {
      message: 'sekme kapanınca vol: anahtarı silinmeli',
    })
    .toBe(0);
});

test('izinsiz site: sekme listelenir, kaydırıcı devre dışı, sessize alma yine çalışır', async () => {
  const ext = await launch();
  await addVolumeSite(ext);
  // 'localhost' için host izni yok (yalnız 127.0.0.1 eklendi): tab.url boş gelir.
  // (Açılıştaki boş sekmenin adresi de gizli; bu yüzden sesli olan aranır.)
  await openPage('localhost', 'c');
  const findBlind = (): Promise<number> =>
    ext.evaluate(async () => {
      const tabs: any[] = await (globalThis as any).chrome.tabs.query({});
      return (tabs.find((t) => !t.url && t.audible)?.id ?? -1) as number;
    });
  await expect.poll(findBlind, { message: 'izinsiz sekme (adres gizli)' }).toBeGreaterThan(-1);
  const id = await findBlind();
  await waitAudible(ext, id);
  await reopenPopup(ext);

  const row = ext.locator('li[data-tab-id="' + id + '"]');
  await expect(row, 'izinsiz sekme de listelenmeli').toHaveCount(1);
  await expect(row.locator('input[type="range"]'), 'izinsiz sitede kaydırıcı devre dışı').toBeDisabled();
  await expect(row.locator('.hint'), 'neden belirtilmeli').toBeVisible();

  await row.locator('.mute').click();
  await expect.poll(() => mutedOf(ext, id), { message: 'izinsiz sitede de sessize alma çalışmalı' }).toBe(true);
});

// ---- YouTube (canlı site, ağ gerekir) ----
const YT_VIDEO_ID = 'aqz-KE-bpKQ';

test('YouTube SPA: VOD → VOD geçişinden sonra ses değeri korunur', async () => {
  brave = await launchBrave({ extensionPath: EXTENSION_PATH });
  const ext = await brave.context.newPage();
  await ext.goto('chrome-extension://' + brave.extensionId + '/popup/popup.html');
  const page = await firstPage(brave.context);
  await openYoutube(page, YT_VIDEO_ID);
  await expect
    .poll(async () => (await playbackStats(page))?.currentTime ?? 0, { message: 'ilk video oynamalı', timeout: 40_000 })
    .toBeGreaterThanOrEqual(3);

  const tabId = await ext.evaluate(async () => {
    const tabs: any[] = await (globalThis as any).chrome.tabs.query({ url: '*://www.youtube.com/*' });
    return tabs[0].id as number;
  });
  await setViaMessage(ext, tabId, VOLUME);
  const ytVolume = (): Promise<number> => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement).volume);
  await expect.poll(ytVolume, { message: 'ilk videoda değer uygulanmalı' }).toBeCloseTo(VOLUME, 2);

  await page.evaluate(() => { (window as unknown as { __oaSpa: number }).__oaSpa = 1; });
  const nextId = await clickRelatedVod(page, YT_VIDEO_ID);
  await expect.poll(() => currentVideoId(page), { message: 'ikinci videoya geçilmeli', timeout: 20_000 }).toBe(nextId);
  const marker = await page.evaluate(() => (window as unknown as { __oaSpa?: number }).__oaSpa ?? 0);
  expect(marker, 'sayfa yenilenmemeli (SPA geçişi)').toBe(1);

  // YouTube geçişte kendi ses değerini yazar; birkaç sn boyunca değer 0.3'te kalmalı.
  await expect.poll(ytVolume, { message: 'SPA geçişinden sonra değer korunmalı', timeout: 15_000 }).toBeCloseTo(VOLUME, 2);
  await sleep(4000);
  expect(await ytVolume(), 'değer sonradan da bozulmamalı').toBeCloseTo(VOLUME, 2);
});
