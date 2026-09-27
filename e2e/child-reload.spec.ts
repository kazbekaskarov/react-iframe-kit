import { expect, test } from '@playwright/test';

// A cross-origin child that reloads gets a fresh `instance`; the parent must detect
// this (not treat it as a duplicate syn) and re-handshake instead of getting stuck.
// See docs/design.md → Handshake: "A syn from a new instance means the child reloaded".

test('reconnects and keeps resizing after the child iframe reloads', async ({ page }) => {
  await page.goto('/cross-origin-resize-host.html');

  const size = page.getByTestId('size');
  await expect(size).not.toHaveText('none');
  const before = await size.textContent();

  const childFrame = () =>
    page.frames().find((f) => f.url().includes('cross-origin-resize-child.html'));
  await childFrame()?.evaluate(() => location.reload());

  // The reload navigates the iframe; Playwright's `frames()` entry for it changes
  // identity, so re-resolve it, and wait for the child's script (which reconnects
  // and reports) to have re-run, not just for the document to be parsed.
  await expect
    .poll(() =>
      childFrame()
        ?.evaluate(() => typeof (window as unknown as { addLine?: unknown }).addLine === 'function')
        .catch(() => false),
    )
    .toBe(true);

  // The fresh instance completed a brand new handshake and reported its size again,
  // rather than the parent getting stuck on the stale one.
  await expect.poll(() => size.textContent()).toBe(before);
});
