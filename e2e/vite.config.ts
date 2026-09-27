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
  server: { host: '127.0.0.1', strictPort: true },
});
