import { defineConfig } from '@playwright/test';

// Tarayıcı projesi yok: Brave testlerin içinde child_process ile başlatılır
// ve chromium.connectOverCDP ile bağlanılır (bkz. tests/helpers/brave.ts).
//
// retries yalnız Twitch ve Kick canlı testlerinde 1 (canlı yayın dalgalanması,
// bkz. docs/known-issues.md). Tekrar denemede geçen test Playwright raporunda
// "flaky" olarak görünür ("1 flaky" özeti ve "flaky" etiketi); sessizce geçmez.
// YouTube ve birim testlerinde retries 0.
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
  projects: [
    { name: 'unit', testMatch: /unit\/.*\.spec\.ts/, retries: 0 },
    { name: 'youtube', testMatch: /youtube\.spec\.ts/, retries: 0 },
    // Yerel fixture, ağ yok: aralıklı hataya yer yok (retries 0).
    { name: 'generic', testMatch: /generic\.spec\.ts/, retries: 0 },
    // Yerel fixture testleri + bir YouTube SPA testi; aralıklı hataya yer yok (retries 0).
    { name: 'volume', testMatch: /volume\.spec\.ts/, retries: 0 },
    { name: 'twitch', testMatch: /twitch\.spec\.ts/, retries: 1 },
    { name: 'kick', testMatch: /kick\.spec\.ts/, retries: 1 },
  ],
});
