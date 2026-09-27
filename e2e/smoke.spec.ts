import { expect, test } from '@playwright/test';
import { CHILD_ORIGIN, HOST_ORIGIN } from './origins';

// Proves the e2e setup itself: React renders on the host origin and the iframe
// loads from a second, different origin.
test('host renders a cross-origin iframe', async ({ page }) => {
  await page.goto(`${HOST_ORIGIN}/`);
  await expect(page.getByRole('heading', { name: 'host' })).toBeVisible();

  const child = page.frameLocator('iframe[title="cross-origin child"]').locator('#child');
  await expect(child).toHaveAttribute('data-origin', CHILD_ORIGIN);
});
