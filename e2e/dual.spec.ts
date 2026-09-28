import { existsSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Frame, type Page, test } from '@playwright/test';

// Two copies of the library on one page, the ESM and the CJS build of the current
// code, used crossed over: they must share one connection per iframe, one child
// connection, the frame context, the Trusted Types policy, and error identity.
// See docs/design.md → Package layout. Needs `pnpm build`.

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const src = fileURLToPath(new URL('../src', import.meta.url));
const ENTRIES = ['index.js', 'index.cjs', 'child/index.js', 'child/index.cjs'];

function buildProblem(): string | undefined {
  if (!ENTRIES.every((entry) => existsSync(`${dist}/${entry}`)))
    return 'no build; run `pnpm build`';
  const built = statSync(`${dist}/index.cjs`).mtimeMs;
  const stale = readdirSync(src, { recursive: true, withFileTypes: true }).some(
    (entry) => entry.isFile() && statSync(`${entry.parentPath}/${entry.name}`).mtimeMs > built,
  );
  return stale ? 'the build is older than src; run `pnpm build`' : undefined;
}
const problem = buildProblem();
// CI builds right before this job; a skip there would hide a broken setup.
if (problem && process.env['CI']) throw new Error(`e2e/dual.spec.ts: ${problem}`);

interface Handshake {
  type: 'syn' | 'ack';
  instance?: string;
  session?: string;
}

/** Records every handshake message each frame receives, before any page script runs. */
async function recordHandshakes(page: Page) {
  await page.addInitScript(() => {
    const seen: unknown[] = [];
    Object.assign(window, { __handshakes: seen });
    window.addEventListener(
      'message',
      ({ data }) => {
        if (data?.rik === 1 && (data.type === 'syn' || data.type === 'ack')) {
          seen.push({ type: data.type, instance: data.instance, session: data.session });
        }
      },
      true,
    );
  });
}

const handshakes = (target: Page | Frame) =>
  target.evaluate(() => (window as unknown as { __handshakes: Handshake[] }).__handshakes);

test.skip(Boolean(problem), problem);

test('ESM and CJS copies share connections, the frame context, the policy and errors', async ({
  page,
}) => {
  // Firefox and WebKit log the library's own cross-origin probes, which it expects to
  // fail: a syn posted while the child iframe is still on about:blank, and (WebKit)
  // a caught read of its contentDocument.
  const expected =
    /Unable to post message to|does not match the recipient window’s origin|Blocked a frame with origin/;
  const errors: string[] = [];
  const record = (text: string) => {
    if (!expected.test(text)) errors.push(text);
  };
  page.on('console', (message) => {
    if (message.type() === 'error') record(message.text());
  });
  page.on('pageerror', (error) => record(`${error.name}: ${error.message}`));
  await recordHandshakes(page);

  const response = await page.goto('/dual-host.html');
  expect(response?.headers()['content-security-policy']).toContain(
    'trusted-types react-iframe-kit',
  );

  // Each copy's <Frame> loads (the second copy reuses the first one's Trusted Types
  // policy: the CSP has no 'allow-duplicates'), and the other copy's useFrame sees it.
  for (const title of ['esm-frame', 'cjs-frame']) {
    await expect(page.frameLocator(`iframe[title="${title}"]`).getByTestId('probe')).toHaveText(
      'inside the frame',
    );
  }

  await expect(page.getByTestId('status')).toHaveText('connected connected');
  const size = page.getByTestId('size');
  await expect(size).not.toHaveText('none');
  await expect(page.locator('iframe[title="child"]')).toHaveJSProperty(
    'clientHeight',
    Number(await size.textContent()),
  );

  // Methods from both child copies, through both parent copies; both directions.
  await page.getByRole('button', { name: 'call' }).click();
  await expect(page.getByTestId('results')).toHaveText('5 6');
  const child = page.frame({ url: /dual-child\.html/ });
  if (!child) throw new Error('the child frame is missing');
  await expect(child.locator('#parent-name')).toHaveText('parent');
  await expect(page.getByTestId('pings')).toHaveText('1');

  await page.getByRole('button', { name: 'fail' }).click();
  await expect(page.getByTestId('remote-error')).toHaveText(
    /^from (esm|cjs), other copy: IframeKitError RemoteError isIframeKitError$/,
  );
  await expect(page.getByTestId('crossed')).toHaveText(
    'IframeKitError TimeoutError isIframeKitError | IframeKitError RemoteError isIframeKitError',
  );

  // One connection: one child instance said syn, and the parent acked it once.
  // Unshared copies would each ack with their own session, or each send their own
  // instance, and keep replacing each other's session.
  const toParent = await handshakes(page);
  expect([...new Set(toParent.map(({ instance }) => instance))]).toEqual([expect.any(String)]);
  const acks = (await handshakes(child)).filter(({ type }) => type === 'ack');
  expect(acks).toHaveLength(1);
  expect(errors).toEqual([]);
});
