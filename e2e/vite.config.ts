import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { TRUSTED_TYPES_CSP } from './trusted-types-csp';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
// A published build unpacked by `pnpm skew:fetch`, for e2e/skew.spec.ts.
const published = (path: string) =>
  fileURLToPath(new URL(`./.published/package/${path}`, import.meta.url));

// Serves e2e/fixtures against the library sources, so e2e runs don't need a build.
export default defineConfig({
  root: fileURLToPath(new URL('./fixtures', import.meta.url)),
  plugins: [
    react(),
    {
      // Strict host CSPs: copyStyles under a nonce policy (e2e/csp.spec.ts), and
      // Trusted Types (e2e/trusted-types.spec.ts). No script-src: Vite's dev client
      // needs inline scripts.
      name: 'csp-fixture-header',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.startsWith('/csp-frame.html')) {
            res.setHeader('Content-Security-Policy', "style-src 'nonce-rik-e2e'");
          }
          if (req.url?.startsWith('/trusted-types.html')) {
            const name = new URL(req.url, 'http://e2e').searchParams.get('case') ?? '';
            const policy = TRUSTED_TYPES_CSP[name];
            if (policy) res.setHeader('Content-Security-Policy', policy);
          }
          next();
        });
      },
    },
  ],
  define: { __DEV__: 'true' },
  resolve: {
    alias: [
      { find: /^react-iframe-kit\/child\/react$/, replacement: src('child/react.ts') },
      { find: /^react-iframe-kit\/child$/, replacement: src('child/index.ts') },
      { find: /^react-iframe-kit$/, replacement: src('index.ts') },
      { find: /^published-kit\/child$/, replacement: published('dist/child/index.js') },
      { find: /^published-kit$/, replacement: published('dist/index.js') },
    ],
    // The published build imports `react` from its own location; one copy only.
    dedupe: ['react', 'react-dom'],
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
