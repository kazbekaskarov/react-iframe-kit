import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, type Page, test } from '@playwright/test';
import { watchConsoleErrors } from './console';

// A host page without React (`react-iframe-kit/host`) and a real cross-origin widget:
// the white-label embed case, where the customer's site loads a script, not React.
// `?iife` runs the `<script>` build instead of the sources; it needs `pnpm build`.
// See docs/design.md → Host without React.

const iife = fileURLToPath(new URL('../dist/host.global.js', import.meta.url));

function widget(page: Page) {
  const frame = page.frames().find((f) => f.url().includes('host-vanilla-child.html'));
  if (!frame) throw new Error('the widget frame is missing');
  return frame;
}

for (const variant of ['sources', 'iife'] as const) {
  test.describe(variant, () => {
    test.skip(
      variant === 'iife' && !existsSync(iife) && !process.env['CI'],
      'no build; run `pnpm build`',
    );
    const url = `/host-vanilla.html${variant === 'iife' ? '?iife' : ''}`;

    test('connects, sizes the iframe, syncs its title and calls both ways', async ({ page }) => {
      // E.g. a message aimed at the widget's origin while the iframe still holds its
      // initial about:blank used to log one.
      const noConsoleErrors = watchConsoleErrors(page);
      await page.goto(url);
      await expect(page.getByTestId('status')).toHaveText('connected');

      const iframe = page.locator('iframe');
      await expect(iframe).toHaveAttribute('title', 'Checkout');
      const content = await widget(page).evaluate(() =>
        Math.ceil(document.documentElement.getBoundingClientRect().height),
      );
      await expect(iframe).toHaveJSProperty('clientHeight', content);

      await widget(page).evaluate(() => (window as unknown as { addLine(): void }).addLine());
      await expect
        .poll(() => iframe.evaluate((element) => element.clientHeight))
        .toBeGreaterThan(content);

      await page.getByRole('button', { name: 'add' }).click();
      await expect(page.getByTestId('result')).toHaveText('5');
      await expect(page.frameLocator('iframe').getByTestId('user')).toHaveText('user 7');
      await page.frameLocator('iframe').getByRole('button', { name: 'submit' }).click();
      await expect(page.getByTestId('submitted')).toHaveText('42');

      await widget(page).evaluate(() =>
        (window as unknown as { rename(t: string): void }).rename('Payment'),
      );
      await expect(iframe).toHaveAttribute('title', 'Payment');
      noConsoleErrors();
    });

    test('makes the widget inert, inside and out', async ({ page }) => {
      await page.goto(url);
      await expect(page.getByTestId('status')).toHaveText('connected');
      const input = page.frameLocator('iframe').getByRole('textbox', { name: 'Name' });
      await input.click();
      await page.getByRole('button', { name: 'inert' }).click();
      await expect(page.locator('iframe')).toHaveAttribute('inert', '');
      await expect
        .poll(() => widget(page).evaluate(() => document.body.hasAttribute('inert')))
        .toBe(true);
      await page.getByRole('button', { name: 'inert' }).click();
      await expect(page.locator('iframe')).not.toHaveAttribute('inert');
      await expect
        .poll(() => widget(page).evaluate(() => document.body.hasAttribute('inert')))
        .toBe(false);
    });
  });
}
