import { defineConfig, type UserConfig } from 'tsdown';

// See docs/design.md → Package layout.

const entry = {
  index: 'src/index.ts',
  'child/index': 'src/child/index.ts',
  'child/lite': 'src/child/lite.ts',
  'child/react': 'src/child/react.ts',
  'host/index': 'src/host/index.ts',
  'devtools/index': 'src/devtools/index.ts',
  'testing/index': 'src/testing/index.ts',
};

// Only entries that export hooks are client modules. Shared chunks (core) must stay
// importable from React Server Components, so they don't get the directive.
const CLIENT_ENTRIES = /^(index|child\/react)\.c?js$/;

const shared: UserConfig = {
  entry,
  format: ['esm', 'cjs'],
  platform: 'neutral',
  target: 'es2020',
  fixedExtension: false,
  clean: false,
  sourcemap: true,
  banner: ({ fileName }) => (CLIENT_ENTRIES.test(fileName) ? "'use client';" : undefined),
  checks: { legacyCjs: false },
};

export default defineConfig([
  // Default (production) build: no dev code, no `process` references.
  {
    ...shared,
    outDir: 'dist',
    dts: true,
    define: { __DEV__: 'false' },
  },
  // Selected by the `development` export condition.
  {
    ...shared,
    outDir: 'dist/dev',
    dts: false,
    define: { __DEV__: 'true' },
  },
  // `<script>` builds for pages without a bundler. One config per entry: an IIFE can't
  // share chunks between entries. The host build has its own global, so a page that is
  // both (a host inside someone else's iframe) can load both.
  iife('child.global', 'src/child/index.ts'),
  iife('child-lite.global', 'src/child/lite.ts'),
  iife('host.global', 'src/host/index.ts', 'ReactIframeKitHost'),
]);

function iife(name: string, source: string, globalName = 'ReactIframeKit'): UserConfig {
  return {
    entry: { [name]: source },
    format: 'iife',
    globalName,
    platform: 'browser',
    target: 'es2020',
    outDir: 'dist',
    // Nothing tree-shakes a `<script>` build after us, so pure annotations are dead
    // weight here; the ESM/CJS builds keep them for the user's bundler.
    outputOptions: { entryFileNames: '[name].js', comments: { annotation: false } },
    clean: false,
    minify: true,
    sourcemap: true,
    define: { __DEV__: 'false' },
  };
}
