// Downloading and unpacking a published build of react-iframe-kit, shared by
// fetch-published.mjs (version-skew tests) and cdn-snippets.mjs (README snippets).
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';

export const PACKAGE = 'react-iframe-kit';

/**
 * The tarball of `spec` (a version or dist-tag), checked against the registry's hash.
 * `waitMs` keeps asking while the registry answers 404: right after `npm publish`, it
 * can take minutes before a new version is served.
 */
export async function downloadPublished(spec, { waitMs = 0 } = {}) {
  const deadline = Date.now() + waitMs;
  let metaResponse;
  for (;;) {
    metaResponse = await fetch(`https://registry.npmjs.org/${PACKAGE}/${spec}`, {
      cache: 'no-store',
    });
    if (metaResponse.status !== 404 || Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, 15_000));
  }
  if (!metaResponse.ok) throw new Error(`${PACKAGE}@${spec}: registry said ${metaResponse.status}`);
  const meta = await metaResponse.json();
  const tgzResponse = await fetch(meta.dist.tarball);
  if (!tgzResponse.ok) throw new Error(`${meta.dist.tarball}: ${tgzResponse.status}`);
  const tgz = Buffer.from(await tgzResponse.arrayBuffer());

  const [algorithm, expected] = meta.dist.integrity.split('-');
  const actual = createHash(algorithm).update(tgz).digest('base64');
  if (actual !== expected) throw new Error(`${PACKAGE}@${meta.version}: integrity mismatch`);
  return { tgz, version: meta.version };
}

/** Minimal ustar reader over a gzipped tarball: regular files, directories and pax `path` overrides. */
export function* tarEntries(tgz) {
  const tar = gunzipSync(tgz);
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
