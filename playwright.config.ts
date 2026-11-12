import { defineConfig } from '@playwright/test';

// Tarayıcı projesi yok: Brave testlerin içinde child_process ile başlatılır
// ve chromium.connectOverCDP ile bağlanılır (bkz. tests/helpers/brave.ts).
export default defineConfig({
  testDir: 'tests',
  testMatch: /.*\.spec\.ts/,
  workers: 1,
  retries: 0,
  timeout: 240_000,
  reporter: 'list',
});
