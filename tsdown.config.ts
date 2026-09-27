import { defineConfig, type UserConfig } from 'tsdown';

// See docs/design.md → Package layout.

const entry = {
  index: 'src/index.ts',
  'child/index': 'src/child/index.ts',
  'child/react': 'src/child/react.ts',
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
  // `<script>` build of the child entry for pages without a bundler.
  {
    entry: { 'child.global': 'src/child/index.ts' },
    format: 'iife',
    globalName: 'ReactIframeKit',
    platform: 'browser',
    target: 'es2020',
    outDir: 'dist',
    outputOptions: { entryFileNames: '[name].js' },
    clean: false,
    minify: true,
    sourcemap: true,
    define: { __DEV__: 'false' },
  },
]);
