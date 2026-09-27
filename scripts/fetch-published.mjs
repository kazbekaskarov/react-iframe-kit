// Unpacks a published build of react-iframe-kit into e2e/.published/package, for the
// version-skew e2e tests (e2e/skew.spec.ts). See docs/design.md → Testing.
//
//   SKEW_VERSION=0.2.0  a specific version or dist-tag (default: latest)
//   SKEW_TARBALL=x.tgz  a local tarball instead (e.g. from `pnpm pack`), to test the
//                       harness itself against the current build
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const PACKAGE = 'react-iframe-kit';
const outDir = fileURLToPath(new URL('../e2e/.published', import.meta.url));

async function download() {
  if (process.env.SKEW_TARBALL) {
    return { tgz: readFileSync(process.env.SKEW_TARBALL), label: process.env.SKEW_TARBALL };
  }
  const spec = process.env.SKEW_VERSION ?? 'latest';
  const metaResponse = await fetch(`https://registry.npmjs.org/${PACKAGE}/${spec}`);
  if (!metaResponse.ok) throw new Error(`${PACKAGE}@${spec}: registry said ${metaResponse.status}`);
  const meta = await metaResponse.json();
  const tgzResponse = await fetch(meta.dist.tarball);
  if (!tgzResponse.ok) throw new Error(`${meta.dist.tarball}: ${tgzResponse.status}`);
  const tgz = Buffer.from(await tgzResponse.arrayBuffer());

  const [algorithm, expected] = meta.dist.integrity.split('-');
  const actual = createHash(algorithm).update(tgz).digest('base64');
  if (actual !== expected) throw new Error(`${PACKAGE}@${meta.version}: integrity mismatch`);
  return { tgz, label: `${PACKAGE}@${meta.version}` };
}

/** Minimal ustar reader: regular files, directories and pax `path` overrides. */
function* entries(tar) {
  let paxPath;
  for (let offset = 0; offset + 512 <= tar.length; ) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const field = (start, length) =>
      header
        .subarray(start, start + length)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = Number.parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1) || '0';
    const prefix = field(345, 155);
    const name = prefix ? `${prefix}/${field(0, 100)}` : field(0, 100);
    const body = tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === 'x') {
      paxPath = /(?:^|\n)\d+ path=([^\n]*)\n/.exec(body.toString('utf8'))?.[1];
      continue;
    }
    if (type === 'g') continue;
    yield { name: paxPath ?? name, type, body };
    paxPath = undefined;
  }
}

const { tgz, label } = await download();
rmSync(outDir, { recursive: true, force: true });
for (const entry of entries(gunzipSync(tgz))) {
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
