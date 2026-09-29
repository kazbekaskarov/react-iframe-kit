import { expect, test } from '@playwright/test';

test('the loader embeds the widget, runs queued commands, and relays the order', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));

  await page.goto('/');
  const iframe = page.locator('[data-tickets] iframe');
  await expect(iframe).toHaveAttribute('title', 'Tickets: Friday concert');
  await expect.poll(() => iframe.evaluate((element) => element.style.height)).toMatch(/^\d+px$/);

  // `prefill` was queued by the page before the loader existed.
  const widget = page.frameLocator('[data-tickets] iframe');
  await expect(widget.getByRole('textbox', { name: 'Email' })).toHaveValue('ann@example.com');

  await widget.getByRole('spinbutton', { name: 'Tickets' }).fill('3');
  await widget.getByRole('button', { name: 'Buy' }).click();
  await expect(page.locator('#orders')).toHaveText(/^A-\d+ \(3\)$/);
  await expect(iframe).toHaveAttribute('title', 'Tickets: order confirmed');

  expect(errors).toEqual([]);
});
