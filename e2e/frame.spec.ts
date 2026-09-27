import { expect, type Page, test } from '@playwright/test';

// `<Frame>` in real browsers. See docs/design.md → Portal mode and `<Frame>`.

function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

const frame = (page: Page) => page.frameLocator('iframe[title="frame"]');
const color = (page: Page) =>
  frame(page)
    .locator('.copied')
    .evaluate((element) => getComputedStyle(element).color);

test('renders children into a standards-mode iframe document', async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto('/frame.html?case=basic');

  const probe = frame(page).getByTestId('probe');
  await expect(probe).toBeVisible();
  await expect(probe).toHaveAttribute('data-realm', 'iframe');
  expect(await probe.evaluate((element) => element.ownerDocument.compatMode)).toBe('CSS1Compat');
  expect(errors).toEqual([]);
});

test('React events work inside the iframe', async ({ page }) => {
  await page.goto('/frame.html?case=basic');
  const button = frame(page).getByRole('button');

  await button.click();
  await button.click();

  await expect(button).toHaveText('clicked 2');
});

test('remounts into the new document after the iframe reloads', async ({ page }) => {
  await page.goto('/frame.html?case=basic');
  const button = frame(page).getByRole('button');
  await button.click();
  await expect(button).toHaveText('clicked 1');

  await frame(page)
    .locator('body')
    .evaluate((body) => body.ownerDocument.defaultView?.location.reload());

  // Fresh document, fresh component state.
  await expect(button).toHaveText('clicked 0');
  await button.click();
  await expect(button).toHaveText('clicked 1');
});

test('renders `head` into the iframe head', async ({ page }) => {
  await page.goto('/frame.html?case=head');
  await expect(frame(page).getByTestId('probe')).toBeVisible();
  expect(await color(page)).toBe('rgb(0, 128, 0)');
});

test('without copyStyles, parent styles do not leak into the iframe', async ({ page }) => {
  await page.goto('/frame.html?case=basic');
  await expect(frame(page).getByTestId('probe')).toBeVisible();
  expect(await color(page)).toBe('rgb(0, 0, 0)');
});

test('copyStyles mirrors parent styles, including later changes', async ({ page }) => {
  await page.goto('/frame.html?case=copy-styles');
  await expect(frame(page).getByTestId('probe')).toBeVisible();
  await expect.poll(() => color(page)).toBe('rgb(255, 0, 0)');

  // Runtime injection, as CSS-in-JS and dev HMR do.
  await page.evaluate(() => {
    const style = document.createElement('style');
    style.id = 'injected';
    style.textContent = '.copied { color: rgb(0, 0, 255); }';
    document.head.append(style);
  });
  await expect.poll(() => color(page)).toBe('rgb(0, 0, 255)');

  await page.evaluate(() => {
    const style = document.getElementById('injected');
    if (style) style.textContent = '.copied { color: rgb(0, 128, 128); }';
  });
  await expect.poll(() => color(page)).toBe('rgb(0, 128, 128)');

  await page.evaluate(() => document.getElementById('injected')?.remove());
  await expect.poll(() => color(page)).toBe('rgb(255, 0, 0)');
});

test('renders into a custom srcDoc', async ({ page }) => {
  await page.goto('/frame.html?case=custom-srcdoc');
  await expect(frame(page).getByRole('heading', { name: 'custom' })).toBeVisible();
  await expect(frame(page).getByTestId('probe')).toBeVisible();
});

test('a sandbox without allow-same-origin renders nothing and reports an error', async ({
  page,
}) => {
  // Read the logged Error's message: Firefox reports console.error(error) as just "Error".
  const reported = page.waitForEvent('console', {
    predicate: async (message) => {
      if (message.type() !== 'error') return false;
      const text = await message
        .args()[0]
        ?.evaluate((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg)));
      return text?.includes('allow-same-origin') ?? false;
    },
  });
  await page.goto('/frame.html?case=sandbox');
  await expect(page.locator('iframe[title="frame"]')).toBeAttached();

  await reported;
  await expect(frame(page).getByTestId('probe')).toHaveCount(0);
});

test('hydrates when the iframe loaded before hydration', async ({ page }) => {
  const errors = consoleErrors(page);
  await page.goto('/hydration.html');

  const root = page.locator('#root');
  await expect(root).toHaveAttribute('data-loaded-before-hydration', 'true');
  await expect(frame(page).getByTestId('content')).toHaveText('hydrated');
  await expect(root).not.toHaveAttribute('data-hydration-error');
  expect(errors).toEqual([]);
});
