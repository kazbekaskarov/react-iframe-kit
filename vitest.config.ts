import { defineConfig } from 'vitest/config';

export default defineConfig({
  define: { __DEV__: 'true' },
  test: {
    environment: 'happy-dom',
    environmentOptions: {
      happyDOM: {
        // Tests create <link> elements; don't let happy-dom try to fetch them.
        settings: {
          disableCSSFileLoading: true,
          disableJavaScriptFileLoading: true,
          handleDisabledFileLoadingAsSuccess: true,
        },
      },
    },
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
      // docs/design.md → Testing: 100% on the framework-agnostic core.
      thresholds: {
        'src/core/**': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
