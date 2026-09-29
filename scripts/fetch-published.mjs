// Unpacks a published build of react-iframe-kit into e2e/.published/package, for the
// version-skew e2e tests (e2e/skew.spec.ts). See docs/design.md → Testing.
//
//   SKEW_VERSION=0.2.0  a specific version or dist-tag (default: latest)
//   SKEW_TARBALL=x.tgz  a local tarball instead (e.g. from `pnpm pack`), to test the
//                       harness itself against the current build
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadPublished, PACKAGE, tarEntries } from './lib/published.mjs';

const outDir = fileURLToPath(new URL('../e2e/.published', import.meta.url));

async function download() {
  if (process.env.SKEW_TARBALL) {
    return { tgz: readFileSync(process.env.SKEW_TARBALL), label: process.env.SKEW_TARBALL };
  }
  const { tgz, version } = await downloadPublished(process.env.SKEW_VERSION ?? 'latest');
  return { tgz, label: `${PACKAGE}@${version}` };
}

const { tgz, label } = await download();
rmSync(outDir, { recursive: true, force: true });
for (const entry of tarEntries(tgz)) {
  const target = normalize(join(outDir, entry.name));
  if (!target.startsWith(outDir + sep)) throw new Error(`refusing to write outside: ${entry.name}`);
  if (entry.type === '5') mkdirSync(target, { recursive: true });
  else if (entry.type === '0') {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.body);
  }
}
const { version } = JSON.parse(readFileSync(join(outDir, 'package', 'package.json'), 'utf8'));
console.log(`Unpacked ${label} (version ${version}) into e2e/.published/package`);
