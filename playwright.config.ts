import { defineConfig, devices } from '@playwright/test';
import { CHILD_PORT, HOST_ORIGIN, HOST_PORT } from './e2e/origins';

const CI = Boolean(process.env['CI']);

const server = (port: number) => ({
  command: `pnpm exec vite --config e2e/vite.config.ts --port ${port}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: !CI,
});

export default defineConfig({
  testDir: 'e2e',
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: HOST_ORIGIN,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: [server(HOST_PORT), server(CHILD_PORT)],
});
