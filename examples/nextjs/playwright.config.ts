// Smoke test of the built example (`npm run build` first). CI runs it against the
// library's own build, to check it in a real Next.js App Router app: server components
// importing the package, 'use client' boundaries, and the handshake after hydration.
import { defineConfig, devices } from '@playwright/test';

const PORT = 3107;

export default defineConfig({
  testDir: 'tests',
  retries: process.env['CI'] ? 2 : 0,
  use: { baseURL: `http://127.0.0.1:${PORT}` },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next start -p ${PORT} -H 127.0.0.1`,
    cwd: import.meta.dirname,
    url: `http://127.0.0.1:${PORT}/`,
    reuseExistingServer: !process.env['CI'],
  },
});
