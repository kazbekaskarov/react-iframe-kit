import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, normalizePath } from 'vite';
import { DUAL_HOST_CSP, TRUSTED_TYPES_CSP } from './trusted-types-csp';

const src = (path: string) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
// A published build unpacked by `pnpm skew:fetch`, for e2e/skew.spec.ts.
const published = (path: string) =>
  fileURLToPath(new URL(`./.published/package/${path}`, import.meta.url));
// The current build (`pnpm build`), for e2e/dual.spec.ts.
const dist = (path: string) => fileURLToPath(new URL(`../dist/${path}`, import.meta.url));
const distDir = normalizePath(dist(''));

// Serves e2e/fixtures against the library sources, so e2e runs don't need a build
// (except e2e/dual.spec.ts, which loads the built ESM and CJS copies).
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
          // A server that never answers, for e2e/third-party.spec.ts. Held until the
          // client goes away.
          if (req.url?.startsWith('/__hang')) return;
          if (req.url?.startsWith('/dual-host.html')) {
            res.setHeader('Content-Security-Policy', DUAL_HOST_CSP);
          }
          next();
        });
      },
    },
    {
      // Serves the CJS build as an ES module, so a page can load it next to the ESM
      // build the way a bundler would (e2e/dual.spec.ts): each `require` becomes an
      // import of the module's `module.exports`, which is the default export.
      name: 'cjs-build-as-esm',
      transform(code, id) {
        const file = id.split('?')[0] ?? id;
        if (!file.startsWith(distDir) || !file.endsWith('.cjs')) return;
        const specifiers = [
          ...new Set(Array.from(code.matchAll(/\brequire\("([^"]+)"\)/g), (match) => match[1])),
        ];
        const imports = specifiers.map(
          (specifier, i) => `import __cjs${i} from ${JSON.stringify(specifier)};`,
        );
        const table = specifiers.map((specifier, i) => `${JSON.stringify(specifier)}: __cjs${i}`);
        return {
          code: [
            ...imports,
            'const module = { exports: {} };',
            'const exports = module.exports;',
            `const modules = { ${table.join(', ')} };`,
            'const require = (id) => {',
            `  if (!(id in modules)) throw new Error('cjs-build-as-esm: no shim for ' + id);`,
            '  return modules[id];',
            '};',
            code,
            'export default module.exports;',
          ].join('\n'),
          map: null,
        };
      },
    },
  ],
  define: { __DEV__: 'true' },
  resolve: {
    alias: [
      { find: /^react-iframe-kit\/child\/react$/, replacement: src('child/react.ts') },
      { find: /^react-iframe-kit\/child\/lite$/, replacement: src('child/lite.ts') },
      { find: /^react-iframe-kit\/devtools$/, replacement: src('devtools/index.ts') },
      { find: /^react-iframe-kit\/host$/, replacement: src('host/index.ts') },
      { find: /^react-iframe-kit\/child$/, replacement: src('child/index.ts') },
      { find: /^react-iframe-kit$/, replacement: src('index.ts') },
      { find: /^published-kit\/child$/, replacement: published('dist/child/index.js') },
      { find: /^published-kit$/, replacement: published('dist/index.js') },
      // Imported with `?raw` (host-vanilla.ts), so match up to the query.
      { find: /^kit-host-iife(?=\?|$)/, replacement: dist('host.global.js') },
      { find: /^kit-esm\/child$/, replacement: dist('child/index.js') },
      { find: /^kit-esm$/, replacement: dist('index.js') },
      { find: /^kit-cjs\/child$/, replacement: dist('child/index.cjs') },
      { find: /^kit-cjs$/, replacement: dist('index.cjs') },
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
