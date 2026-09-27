import { expect, test } from '@playwright/test';

// Real cross-origin resize: two dev-server ports, so this is a genuine
// parent-window ↔ child-window handshake over `postMessage`/`MessagePort`, not a
// same-document portal. See docs/design.md → Wire protocol, Resize.

test("sizes a cross-origin iframe from the child's autoResize report", async ({ page }) => {
  await page.goto('/cross-origin-resize-host.html');

  const frame = page.frameLocator('iframe[title="frame"]');
  await expect(frame.getByText('3')).toBeVisible();

  // Waits for `useIframeResize`'s own state (only set from a real wire report, since
  // this iframe is cross-origin — there is no local measurement to fall back to).
  const size = page.getByTestId('size');
  await expect(size).not.toHaveText('none');
  const [reportedWidth, reportedHeight] = (await size.textContent())?.split('x').map(Number) ?? [];
  expect(reportedWidth).toBeGreaterThan(0);
  expect(reportedHeight).toBeGreaterThan(0);
  if (reportedHeight === undefined) throw new Error('unreachable: asserted above');

  // The reported height is what actually got applied to the iframe.
  const iframe = page.locator('iframe[title="frame"]');
  await expect(iframe).toHaveJSProperty('clientHeight', reportedHeight);

  // Cross-origin, so the child's `addLine` can only be called through Playwright's own
  // (CDP/BiDi) frame access, never from the host page's JS (same-origin policy would,
  // correctly, block that — it's the reason this library needs a wire protocol).
  const childFrame = page.frames().find((f) => f.url().includes('cross-origin-resize-child.html'));
  await childFrame?.evaluate(() => (window as unknown as { addLine: () => void }).addLine());

  await expect
    .poll(() => iframe.evaluate((el: HTMLIFrameElement) => el.clientHeight))
    .toBeGreaterThan(reportedHeight);
});
