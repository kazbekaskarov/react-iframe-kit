import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));

// Serves e2e/fixtures against the library sources, so e2e runs don't need a build.
export default defineConfig({
  root: fileURLToPath(new URL('./fixtures', import.meta.url)),
  plugins: [react()],
  define: { __DEV__: 'true' },
  resolve: {
    alias: [
      { find: /^react-iframe-kit\/child\/react$/, replacement: src('child/react.ts') },
      { find: /^react-iframe-kit\/child$/, replacement: src('child/index.ts') },
      { find: /^react-iframe-kit$/, replacement: src('index.ts') },
    ],
  },
  server: {
    host: '127.0.0.1',
    strictPort: true,
    // A sandboxed-without-allow-same-origin fixture loads its ES modules from an
    // opaque ("null") document origin; browsers apply CORS to `type="module"`
    // fetches, so this reflects any request origin (including "null") the same
    // way a real CDN would need to for that scenario. Only used by the e2e dev
    // server, never in a built package.
    cors: true,
  },
});
