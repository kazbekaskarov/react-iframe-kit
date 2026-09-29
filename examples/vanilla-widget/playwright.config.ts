// Smoke test of the example on its two origins. CI runs it against the library's own
// build installed into the example.
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  retries: process.env['CI'] ? 2 : 0,
  use: { baseURL: 'http://localhost:8080' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node serve.mjs',
    cwd: import.meta.dirname,
    url: 'http://localhost:8081/loader.js',
    reuseExistingServer: !process.env['CI'],
  },
});
