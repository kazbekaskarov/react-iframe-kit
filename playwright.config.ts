import { defineConfig, devices } from '@playwright/test';
import { CHILD_PORT, HOST_ORIGIN, HOST_PORT } from './e2e/origins';

const CI = Boolean(process.env['CI']);

// Vite is started with plain `node`, not `pnpm exec`: on Linux pnpm doesn't forward
// SIGTERM to vite, and Playwright then waits forever for the server to exit.
const server = (port: number) => ({
  command: `node node_modules/vite/bin/vite.js --config e2e/vite.config.ts --port ${port}`,
  url: `http://127.0.0.1:${port}/`,
  reuseExistingServer: !CI,
  gracefulShutdown: { signal: 'SIGTERM' as const, timeout: 5_000 },
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
    // iOS Safari's viewport, touch input and scaling, for the embed paths that
    // matter on phones: the handshake, cross-origin resize, calls and reloads.
    {
      name: 'mobile-webkit',
      use: { ...devices['iPhone 15'] },
      testMatch: [
        'child-reload.spec.ts',
        'cross-origin-resize.spec.ts',
        'frame.spec.ts',
        'resize.spec.ts',
        'rpc.spec.ts',
        'sandboxed-child.spec.ts',
      ],
    },
  ],
  webServer: [server(HOST_PORT), server(CHILD_PORT)],
});
