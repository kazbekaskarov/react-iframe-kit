// Smoke tests for the built docs site: `pnpm --dir site build`, then from the repo root
// `pnpm exec playwright test -c site/playwright.config.ts`.
import { defineConfig, devices } from '@playwright/test';

const PORT = 4321;

export default defineConfig({
  testDir: 'tests',
  forbidOnly: Boolean(process.env['CI']),
  reporter: process.env['CI'] ? 'github' : 'list',
  use: { baseURL: `http://127.0.0.1:${PORT}/react-iframe-kit/` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `node node_modules/astro/bin/astro.mjs preview --host 127.0.0.1 --port ${PORT}`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${PORT}/react-iframe-kit/`,
    reuseExistingServer: !process.env['CI'],
  },
});
