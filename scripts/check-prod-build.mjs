// Checks that the production build carries no dev-only code: no `console.warn` (every
// warning is behind `__DEV__`) and no `process` reference. See docs/design.md →
// Package layout ("Dev builds only add warnings").
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const forbidden = [/console\.warn\b/, /\bprocess\./];

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (path !== join(dist, 'dev')) yield* files(path);
    } else if (/\.c?js$/.test(entry.name)) {
      yield path;
    }
  }
}

const problems = [];
for (const file of files(dist)) {
  const code = readFileSync(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(code)) problems.push(`${relative(dist, file)}: matches ${pattern}`);
  }
}

if (problems.length > 0) {
  console.error(`The production build contains dev-only code:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
console.log('Production build: no dev-only code.');
