// Docs site for react-iframe-kit. Demos import the library straight from ../src, so
// the site always shows the code on this branch, not the last release.
import { fileURLToPath } from 'node:url';
import react from '@astrojs/react';
import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';

const src = (path) => fileURLToPath(new URL(`../src/${path}`, import.meta.url));
const repo = 'https://github.com/kazbekaskarov/react-iframe-kit';

export default defineConfig({
  site: 'https://kazbekaskarov.github.io',
  base: '/react-iframe-kit',
  integrations: [
    starlight({
      title: 'react-iframe-kit',
      description:
        'Hooks-first React toolkit for iframes: portal rendering, auto-resize and a typed RPC bridge in one package.',
      social: [{ icon: 'github', label: 'GitHub', href: repo }],
      editLink: { baseUrl: `${repo}/edit/main/site/` },
      sidebar: [
        { label: 'Start here', items: ['getting-started', 'comparison'] },
        {
          label: 'Guides',
          items: [
            'guides/portal',
            'guides/resize',
            'guides/rpc',
            'guides/security',
            'guides/accessibility',
            'guides/testing',
          ],
        },
        { label: 'Playground', items: ['playground'] },
        { label: 'Reference', items: ['reference/api', 'reference/errors'] },
      ],
    }),
    react(),
  ],
  vite: {
    define: { __DEV__: 'false' },
    resolve: {
      alias: [
        { find: /^react-iframe-kit\/child\/react$/, replacement: src('child/react.ts') },
        { find: /^react-iframe-kit\/child$/, replacement: src('child/index.ts') },
        { find: /^react-iframe-kit$/, replacement: src('index.ts') },
      ],
      // ../src resolves `react` from the repo root; the site must use its own copy.
      dedupe: ['react', 'react-dom'],
    },
  },
});
