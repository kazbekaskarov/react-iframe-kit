import { expect, test } from '@playwright/test';

test('the host and the widget connect, size, and talk both ways', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto('/');
  await expect(page.getByTestId('status')).toHaveText('connected');
  const widget = page.frameLocator('iframe');
  await expect(widget.getByTestId('widget-status')).toHaveText('connected');

  // Sized to its content, and titled by the page inside.
  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('title', 'Tickets: choose your seats');
  await expect.poll(() => iframe.evaluate((element) => element.style.height)).toMatch(/^\d+px$/);

  await page.getByRole('button', { name: 'Prefill email' }).click();
  await expect(widget.getByRole('textbox', { name: 'Email' })).toHaveValue('ann@example.com');

  await widget.getByRole('button', { name: 'Buy' }).click();
  await expect(page.getByTestId('orders')).toHaveText(/^A-\d+ \(1\)$/);

  expect(errors).toEqual([]);
});
