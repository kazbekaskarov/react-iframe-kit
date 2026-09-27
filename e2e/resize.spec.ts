import { expect, type Page, test } from '@playwright/test';

// Same-origin resize in real browsers. See docs/design.md → Resize.

interface Fit {
  /** The iframe's viewport (content box). */
  viewportWidth: number;
  viewportHeight: number;
  /** The iframe document's content size. */
  contentWidth: number;
  contentHeight: number;
  scrollbar: boolean;
}

async function frameSize(page: Page): Promise<Fit> {
  return page.locator('iframe[title="frame"]').evaluate((iframe: HTMLIFrameElement) => {
    const root = iframe.contentDocument?.documentElement;
    if (!root) throw new Error('iframe document is not accessible');
    const rect = root.getBoundingClientRect();
    return {
      viewportWidth: iframe.clientWidth,
      viewportHeight: iframe.clientHeight,
      contentWidth: Math.ceil(rect.width),
      contentHeight: Math.ceil(rect.height),
      scrollbar: root.scrollHeight > root.clientHeight,
    };
  });
}

/** Waits until the iframe is exactly as tall as its content, and returns that height. */
async function expectHeightFits(page: Page): Promise<number> {
  await expect
    .poll(async () => {
      const f = await frameSize(page);
      return f.viewportHeight === f.contentHeight && !f.scrollbar;
    })
    .toBe(true);
  return (await frameSize(page)).viewportHeight;
}

test('height follows the content as it grows and shrinks', async ({ page }) => {
  await page.goto('/resize.html?case=lines');
  const initial = await expectHeightFits(page);

  await page.getByRole('button', { name: 'more' }).click();
  const grown = await expectHeightFits(page);
  expect(grown).toBeGreaterThan(initial);

  await page.getByRole('button', { name: 'less' }).click();
  const shrunk = await expectHeightFits(page);
  expect(shrunk).toBe(initial);
  await expect(page.locator('#root')).not.toHaveAttribute('data-loop');
});

test('clamps to maxHeight', async ({ page }) => {
  await page.goto('/resize.html?case=max-height');
  await expect.poll(async () => (await frameSize(page)).viewportHeight).toBe(120);
  expect((await frameSize(page)).contentHeight).toBeGreaterThan(120);
});

test('width follows a shrink-wrapped document with axis "both"', async ({ page }) => {
  await page.goto('/resize.html?case=both-axes');
  await expect.poll(async () => (await frameSize(page)).viewportWidth).toBe(200);
  await expect.poll(async () => (await frameSize(page)).viewportHeight).toBe(80);

  await page.getByRole('button', { name: 'wider' }).click();
  await expect.poll(async () => (await frameSize(page)).viewportWidth).toBe(350);
});

test('a long animation does not trip the feedback-loop guard', async ({ page }) => {
  await page.goto('/resize.html?case=accordion');
  await expectHeightFits(page);

  await page.getByRole('button', { name: 'toggle' }).click();
  await page.waitForTimeout(1_800); // the transition takes 1.5 s

  const height = await expectHeightFits(page);
  expect(height).toBeGreaterThanOrEqual(900);
  await expect(page.locator('#root')).not.toHaveAttribute('data-loop');
});

test('the feedback-loop guard stops content sized from the viewport', async ({ page }) => {
  await page.goto('/resize.html?case=viewport-loop');
  await expect(page.locator('#root')).toHaveAttribute('data-loop', 'height');

  const held = (await frameSize(page)).viewportHeight;
  await page.waitForTimeout(500);
  expect((await frameSize(page)).viewportHeight).toBe(held);
});

test('a hidden iframe keeps its size instead of collapsing', async ({ page }) => {
  await page.goto('/resize.html?case=hidden');
  const height = await expectHeightFits(page);
  const toggle = page.getByRole('button', { name: 'visibility' });

  await toggle.click();
  await page.waitForTimeout(300);
  const hiddenStyle = await page
    .locator('iframe[title="frame"]')
    .evaluate((iframe: HTMLIFrameElement) => iframe.style.height);
  expect(hiddenStyle).toBe(`${height}px`);

  await toggle.click();
  expect(await expectHeightFits(page)).toBe(height);
});

test('useIframeResize sizes a plain same-origin iframe through a RefObject', async ({ page }) => {
  await page.goto('/resize.html?case=plain-iframe');
  const height = await expectHeightFits(page);
  await expect(page.getByTestId('size')).toHaveText(new RegExp(`x${height}$`));
});

test('apply: false only reports the size', async ({ page }) => {
  await page.goto('/resize.html?case=report-only');
  await expect(page.getByTestId('size')).toHaveText(/^\d+x\d+$/);

  const reported = Number((await page.getByTestId('size').textContent())?.split('x')[1]);
  const f = await frameSize(page);
  expect(f.viewportHeight).toBe(150); // the browser default, untouched
  expect(reported).toBe(f.contentHeight);
  expect(reported).toBeGreaterThan(150);
});
