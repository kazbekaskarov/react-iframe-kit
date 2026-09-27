import { expect, test } from '@playwright/test';

// A sandboxed child without `allow-same-origin` has an opaque ("null") origin, in
// every browser. See docs/design.md → Security → Opaque origins.

test('connects and reports size with the explicit origin: "null" opt-in', async ({ page }) => {
  await page.goto('/sandboxed-host.html?origin=null');

  const frame = page.frameLocator('iframe[title="frame"]');
  await expect(frame.getByText('sandboxed')).toBeVisible();

  const size = page.getByTestId('size');
  await expect(size).not.toHaveText('none');

  const iframe = page.locator('iframe[title="frame"]');
  const reportedHeight = Number((await size.textContent())?.split('x')[1]);
  await expect(iframe).toHaveJSProperty('clientHeight', reportedHeight);
});

test('never connects without the opt-in: opacity is not auto-derived', async ({ page }) => {
  await page.goto('/sandboxed-host.html');

  const frame = page.frameLocator('iframe[title="frame"]');
  await expect(frame.getByText('sandboxed')).toBeVisible(); // the child itself renders fine

  await page.waitForTimeout(1_000); // give a (wrongly) accepted handshake time to land
  await expect(page.getByTestId('size')).toHaveText('none');
});
