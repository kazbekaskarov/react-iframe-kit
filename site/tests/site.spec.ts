import { expect, type Page, test } from '@playwright/test';

const PAGES = [
  '',
  'getting-started/',
  'comparison/',
  'guides/migrate-from-iframe-resizer/',
  'guides/portal/',
  'guides/resize/',
  'guides/rpc/',
  'guides/embedding/',
  'guides/without-the-library/',
  'guides/third-party/',
  'guides/security/',
  'guides/accessibility/',
  'guides/testing/',
  'playground/',
  'reference/api/',
  'reference/errors/',
];

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  return errors;
}

for (const path of PAGES) {
  test(`/${path} renders without errors`, async ({ page }) => {
    const errors = collectErrors(page);
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1').first()).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test('the playground renders the markup and follows its height', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('playground/');
  const frame = page.frameLocator('iframe[title="Playground output"]');
  await expect(frame.getByRole('heading', { name: 'Hello from inside the iframe' })).toBeVisible();

  const iframe = page.locator('iframe[title="Playground output"]');
  const before = await iframe.evaluate((el) => el.getBoundingClientRect().height);
  await frame.getByText('Open me').click();
  await expect
    .poll(() => iframe.evaluate((el) => el.getBoundingClientRect().height))
    .toBeGreaterThan(before);

  await page.getByRole('textbox').first().fill('<p id="typed">typed live</p>');
  await expect(frame.locator('#typed')).toHaveText('typed live');
  expect(errors).toEqual([]);
});

test('the RPC demo connects and talks both ways', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('guides/rpc/');
  await expect(page.getByText('status: connected')).toBeVisible();

  await page.getByRole('button', { name: 'remote.setColor()' }).click();
  await expect(page.getByText(/setColor\('#[0-9a-f]{6}'\) resolved/)).toBeVisible();

  const child = page.frameLocator('iframe[title="RPC demo child"]');
  await child.getByRole('button', { name: "emit('clicked')" }).click();
  await expect(page.getByText('event clicked { count: 1 }')).toBeVisible();
  await page.getByRole('button', { name: 'remote.getClicks()' }).click();
  await expect(page.getByText('getClicks() → 1')).toBeVisible();

  await child.getByRole('button', { name: 'remote.now()' }).click();
  await expect(child.getByText(/^parent says /)).toBeVisible();
  expect(errors).toEqual([]);
});
