import { chromium } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';

export const BRAVE_PATH = 'C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe';

export interface LaunchedBrave {
  browser: Browser;
  context: BrowserContext;
  port: number;
  profileDir: string;
  pid: number;
  extensionId: string;
  close(): Promise<void>;
}

export interface LaunchOptions {
  extensionPath: string;
  /** Service worker yolu (uzantı köküne göre). Varsayılan: background/sw.js */
  serviceWorkerPath?: string;
  /**
   * Varsayılan true (--mute-audio). false: ses çıkışı açık kalır; yalnız tab.audible'ın gerçekten
   * true olması gereken testler için (--mute-audio altında Chromium sekmeyi sesli saymıyor).
   */
  muteAudio?: boolean;
}

const portOfBrowser = new WeakMap<Browser, number>();

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
  });
}

async function httpJson(url: string): Promise<any> {
  const res = await fetch(url);
  return res.json();
}

function killTree(pid: number): void {
  try {
    // Yalnız kendi başlattığımız süreç ağacı. Asla /IM kullanılmaz.
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // süreç zaten kapanmış olabilir
  }
}

async function removeDir(dir: string): Promise<void> {
  for (let i = 0; i < 20; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      if (!fs.existsSync(dir)) return;
    } catch {
      // Windows kilidi: bekle ve yeniden dene
    }
    await sleep(500);
  }
  if (fs.existsSync(dir)) {
    console.warn('[brave] profil dizini silinemedi: ' + dir);
  }
}

/**
 * Brave'i Playwright dışında başlatır, CDP ile bağlar ve uzantının service
 * worker'ının yüklendiğini doğrular. Hata olursa kendi kurduğu her şeyi temizler.
 */
export async function launchBrave(opts: LaunchOptions): Promise<LaunchedBrave> {
  const extensionPath = path.resolve(opts.extensionPath);
  const swPath = opts.serviceWorkerPath ?? 'background/sw.js';
  if (!fs.existsSync(path.join(extensionPath, 'manifest.json'))) {
    throw new Error('uzantı yüklenmedi: manifest.json yok: ' + extensionPath);
  }

  const port = await freePort();
  const profilesRoot = path.join(os.tmpdir(), 'only-audio-profiles');
  fs.mkdirSync(profilesRoot, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(profilesRoot, 'p-'));

  const args = [
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profileDir,
    '--disable-extensions-except=' + extensionPath,
    '--load-extension=' + extensionPath,
    ...(opts.muteAudio === false ? [] : ['--mute-audio']),
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1300,900',
    'about:blank',
  ];
  const child: ChildProcess = spawn(BRAVE_PATH, args, { stdio: 'ignore', detached: false });
  const pid = child.pid ?? 0;
  let browser: Browser | undefined;
  let closed = false;

  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if (browser) {
      try { await Promise.race([browser.close(), sleep(3000)]); } catch { /* yoksay */ }
    }
    if (pid) killTree(pid);
    await sleep(500);
    await removeDir(profileDir);
  };

  try {
    let alive = false;
    for (let i = 0; i < 60 && !alive; i++) {
      try { await httpJson('http://127.0.0.1:' + port + '/json/version'); alive = true; } catch { await sleep(500); }
    }
    if (!alive) throw new Error('Brave CDP uç noktası açılmadı (port ' + port + ')');

    browser = await chromium.connectOverCDP('http://127.0.0.1:' + port);
    portOfBrowser.set(browser, port);
    const context = browser.contexts()[0];
    if (!context) throw new Error('Brave varsayılan bağlamı yok');

    let extensionId = '';
    const suffix = '/' + swPath;
    for (let i = 0; i < 40 && !extensionId; i++) {
      const targets: any[] = await httpJson('http://127.0.0.1:' + port + '/json/list');
      const sw = targets.find((t) => t.type === 'service_worker' && String(t.url).startsWith('chrome-extension://') && String(t.url).endsWith(suffix));
      if (sw) extensionId = String(sw.url).split('/')[2];
      else await sleep(500);
    }
    if (!extensionId) {
      throw new Error('uzantı yüklenmedi: service worker hedefi yok (' + swPath + '). manifest veya kural JSON geçersiz olabilir.');
    }
    return { browser, context, port, profileDir, pid, extensionId, close };
  } catch (e) {
    await close();
    throw e;
  }
}

/** Bağlamdaki uzantı dışı sayfalardan ilkini döndürür; yoksa yenisini açar. */
export async function firstPage(context: BrowserContext): Promise<Page> {
  const pages = context.pages().filter((p) => !p.url().startsWith('chrome-extension://'));
  return pages[0] ?? (await context.newPage());
}

// ---------------------------------------------------------------------------
// Bayt sayacı: Playwright'tan bağımsız ham CDP WebSocket'i. Sayfa hedefine ve
// onun Worker'larına (Twitch segment istekleri) Target.setAutoAttach ile bağlanır.
// ---------------------------------------------------------------------------

export interface ByteCounter {
  /** Şu ana dek eşleşen isteklerin kümülatif kodlanmış (ağ) bayt toplamı. */
  bytes(): number;
  /** Yalnız Worker oturumlarından gelen eşleşen baytlar (kanıt için). */
  workerBytes(): number;
  requestCount(): number;
  workerRequestCount(): number;
  /** Tanılama: eşleşen baytların ana makine + dosya uzantısına göre kümülatif dökümü. */
  breakdown(): Record<string, number>;
  stop(): Promise<void>;
}

interface ReqInfo { url: string; viaWorker: boolean; received: number; finished: number; matched: boolean }

/**
 * Sayfa gezinmeden ÖNCE çağrılmalı (Worker'lar oluşurken bağlanılmalı).
 * hostPattern: RegExp veya alt dize; istek URL'sine uygulanır.
 */
export async function countBytes(page: Page, hostPattern: RegExp | string): Promise<ByteCounter> {
  const match = (url: string): boolean => (typeof hostPattern === 'string' ? url.includes(hostPattern) : hostPattern.test(url));

  const browser = page.context().browser();
  const port = browser ? portOfBrowser.get(browser) : undefined;
  if (!port) throw new Error('countBytes: tarayıcı launchBrave ile başlatılmamış');

  const pwSession = await page.context().newCDPSession(page);
  const info: any = await pwSession.send('Target.getTargetInfo');
  const targetId: string = info.targetInfo.targetId;
  await pwSession.detach().catch(() => undefined);

  const version: any = await httpJson('http://127.0.0.1:' + port + '/json/version');
  const ws = new WebSocket(String(version.webSocketDebuggerUrl));
  await new Promise<void>((resolve, reject) => {
    ws.onopen = () => resolve();
    ws.onerror = () => reject(new Error('sayaç WebSocket açılamadı'));
  });

  let nextId = 1;
  const pending = new Map<number, (v: any) => void>();
  const sessionKind = new Map<string, string>(); // sessionId -> 'page' | 'worker'
  const reqs = new Map<string, ReqInfo>(); // sessionId|requestId -> bilgi

  const send = (method: string, params: object, sessionId?: string): Promise<any> =>
    new Promise((resolve) => {
      const id = nextId++;
      pending.set(id, resolve);
      const msg: any = { id, method, params };
      if (sessionId) msg.sessionId = sessionId;
      ws.send(JSON.stringify(msg));
    });

  const attachChildren = (sessionId: string): Promise<any> =>
    send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: true }, sessionId);

  ws.onmessage = (ev: MessageEvent) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id !== undefined && pending.has(msg.id)) {
      pending.get(msg.id)!(msg.result ?? msg.error);
      pending.delete(msg.id);
      return;
    }
    if (msg.method === 'Target.attachedToTarget') {
      const ti = msg.params.targetInfo;
      const childSid: string = msg.params.sessionId;
      if (ti.type === 'worker' || ti.type === 'shared_worker' || ti.type === 'service_worker') {
        sessionKind.set(childSid, 'worker');
        void send('Network.enable', {}, childSid);
        void attachChildren(childSid);
        void send('Runtime.runIfWaitingForDebugger', {}, childSid);
      } else if (ti.type === 'iframe') {
        // oop iframe: sayfa sayılır
        sessionKind.set(childSid, 'page');
        void send('Network.enable', {}, childSid);
        void attachChildren(childSid);
        void send('Runtime.runIfWaitingForDebugger', {}, childSid);
      }
      return;
    }
    const sid: string | undefined = msg.sessionId;
    if (!sid || !sessionKind.has(sid)) return;
    const worker = sessionKind.get(sid) === 'worker';
    const p = msg.params;
    if (msg.method === 'Network.requestWillBeSent') {
      const key = sid + '|' + p.requestId;
      const prev = reqs.get(key);
      reqs.set(key, { url: p.request.url, viaWorker: worker, received: prev ? prev.received : 0, finished: prev ? prev.finished : 0, matched: match(p.request.url) });
    } else if (msg.method === 'Network.dataReceived') {
      const r = reqs.get(sid + '|' + p.requestId);
      if (r) r.received += p.encodedDataLength || 0;
    } else if (msg.method === 'Network.loadingFinished') {
      const r = reqs.get(sid + '|' + p.requestId);
      if (r) r.finished = p.encodedDataLength || 0;
    }
  };

  const attached: any = await send('Target.attachToTarget', { targetId, flatten: true });
  const pageSid: string = attached.sessionId;
  sessionKind.set(pageSid, 'page');
  await send('Network.enable', {}, pageSid);
  await attachChildren(pageSid);

  const total = (workerOnly: boolean, count: boolean): number => {
    let sum = 0;
    for (const r of reqs.values()) {
      if (!r.matched) continue;
      if (workerOnly && !r.viaWorker) continue;
      sum += count ? 1 : Math.max(r.received, r.finished);
    }
    return sum;
  };

  return {
    bytes: () => total(false, false),
    workerBytes: () => total(true, false),
    requestCount: () => total(false, true),
    workerRequestCount: () => total(true, true),
    breakdown: () => {
      const out: Record<string, number> = {};
      for (const r of reqs.values()) {
        if (!r.matched) continue;
        let key = r.url;
        try {
          const u = new URL(r.url);
          const ext = (u.pathname.match(/\.([A-Za-z0-9]+)$/) || ['', '?'])[1];
          key = u.hostname + ' .' + ext;
        } catch { /* ham URL kalır */ }
        out[key] = (out[key] ?? 0) + Math.max(r.received, r.finished);
      }
      return out;
    },
    stop: async () => { try { ws.close(); } catch { /* yoksay */ } },
  };
}
