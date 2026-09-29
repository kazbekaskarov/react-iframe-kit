// Keeps the `<script>` snippets in the docs pinned to a version, with Subresource
// Integrity, so a copied snippet never changes behaviour under its users (an unpinned
// URL would silently pick up every new major) and a tampered CDN file doesn't run.
//
//   node scripts/cdn-snippets.mjs             rewrite the snippets for package.json's
//                                             version, hashing the published files
//   node scripts/cdn-snippets.mjs --from-dist the same, hashing ./dist (run by
//                                             `pnpm version-packages`, before publish)
//   node scripts/cdn-snippets.mjs --check     fail unless every snippet matches the
//                                             published files (run after publish)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { downloadPublished, PACKAGE, tarEntries } from './lib/published.mjs';

const root = new URL('../', import.meta.url);
const FILES = [
  'README.md',
  'site/src/content/docs/getting-started.mdx',
  'site/src/content/docs/guides/embedding.mdx',
  'site/src/content/docs/guides/migrate-from-iframe-resizer.mdx',
];
const SNIPPET =
  /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/react-iframe-kit(?:@[^/"]+)?\/dist\/([\w-]+\.global\.js)"[^>]*><\/script>/g;

const mode = process.argv[2];
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

/**
 * `dist/<name>` → its bytes, from ./dist or from the published tarball; `undefined` for a
 * file that version doesn't have (a build added after it was released).
 */
async function loadFiles() {
  if (mode === '--from-dist') {
    return (name) => readFileSync(new URL(`dist/${name}`, root));
  }
  const { tgz } = await downloadPublished(version);
  const files = new Map();
  for (const entry of tarEntries(tgz)) {
    if (entry.type === '0') files.set(entry.name.replace(/^package\//, ''), entry.body);
  }
  return (name) => files.get(`dist/${name}`);
}

const read = await loadFiles();
const missing = new Set();
const snippet = (match, name) => {
  const body = read(name);
  if (!body) {
    missing.add(name);
    return match; // pinned by the first release that has it
  }
  const integrity = `sha384-${createHash('sha384').update(body).digest('base64')}`;
  return `<script src="https://cdn.jsdelivr.net/npm/${PACKAGE}@${version}/dist/${name}" integrity="${integrity}" crossorigin="anonymous"></script>`;
};

const stale = [];
for (const file of FILES) {
  const url = new URL(file, root);
  let text;
  try {
    text = readFileSync(url, 'utf8');
  } catch {
    continue; // not every listed page exists on every branch
  }
  const next = text.replace(SNIPPET, snippet);
  if (next === text) continue;
  if (mode === '--check') stale.push(file);
  else writeFileSync(url, next);
}

if (missing.size > 0) {
  console.warn(
    `${PACKAGE}@${version} has no ${[...missing].join(', ')}; left those snippets as they are.`,
  );
}
if (mode === '--check') {
  if (stale.length > 0 || missing.size > 0) {
    console.error(
      `These CDN snippets don't match ${PACKAGE}@${version} as published:\n  ${stale.join('\n  ')}\nRun \`node scripts/cdn-snippets.mjs\` and commit the result.`,
    );
    process.exit(1);
  }
  console.log(`CDN snippets match ${PACKAGE}@${version}.`);
} else {
  console.log(`CDN snippets pinned to ${PACKAGE}@${version} (${fileURLToPath(root)}).`);
}
