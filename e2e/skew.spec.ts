import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';

// Version skew: the current parent against a published child build, and a published
// parent against the current child. `pnpm skew:fetch` unpacks the build (latest by
// default) into e2e/.published. See docs/design.md → Testing, Versioning.

const root = fileURLToPath(new URL('./.published/package', import.meta.url));
const version: string | undefined = existsSync(`${root}/package.json`)
  ? JSON.parse(readFileSync(`${root}/package.json`, 'utf8')).version
  : undefined;

/** Names a published entry exports at runtime, read from its `export { … }` list. */
function exportsOf(entry: string): Set<string> {
  const file = `${root}/dist/${entry}.js`;
  if (!existsSync(file)) return new Set();
  const names = new Set<string>();
  for (const [, list = ''] of readFileSync(file, 'utf8').matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const item of list.split(',')) {
      const name = item
        .split(/\s+as\s+/)
        .pop()
        ?.trim();
      if (name) names.add(name);
    }
  }
  return names;
}

const notFetched = 'no published build unpacked; run `pnpm skew:fetch` first';

async function expectFullPair(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('status')).toHaveText('connected');

  // The child's autoResize report reached the parent and was applied.
  const size = page.getByTestId('size');
  await expect(size).not.toHaveText('none');
  const height = Number(await size.textContent());
  await expect(page.locator('iframe[title="frame"]')).toHaveJSProperty('clientHeight', height);

  // Parent → child call.
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('sum')).toHaveText('5');

  // Child → parent call, then a child → parent event.
  const child = page.frameLocator('iframe[title="frame"]');
  await expect(child.locator('#parent-name')).toHaveText('parent');
  await expect(page.getByTestId('pings')).not.toHaveText('0');
}

test.describe('current parent with the published child', () => {
  test.skip(!version, notFetched);
  test.skip(
    !exportsOf('child/index').has('connectToParent'),
    `react-iframe-kit@${version}'s child entry has no connectToParent: it predates the protocol`,
  );

  test('connects, resizes, calls both ways and delivers events', async ({ page }) => {
    await expectFullPair(page, '/skew-current-parent.html');
  });
});

test.describe('published parent with the current child', () => {
  test.skip(!version, notFetched);
  test.skip(
    !['useIframeRPC', 'useIframeEvent', 'useIframeResize'].every((name) =>
      exportsOf('index').has(name),
    ),
    `react-iframe-kit@${version} has no useIframeRPC/useIframeEvent/useIframeResize: it predates the protocol`,
  );

  test('connects, resizes, calls both ways and delivers events', async ({ page }) => {
    await expectFullPair(page, '/skew-published-parent.html');
  });
});
