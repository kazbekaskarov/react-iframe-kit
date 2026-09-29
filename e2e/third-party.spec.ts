import { expect, test } from '@playwright/test';

// `useIframeLoad` on cross-origin iframes that don't run the library: the status comes
// from the native `load` alone. `/__hang` never answers (e2e/vite.config.ts). See
// docs/design.md → Third-party iframes.

test('reports loaded, a timeout, and no timeout for a lazy iframe out of view', async ({
  page,
}) => {
  // Not the page's `load`: it waits for the iframe that never answers.
  await page.goto('/third-party.html', { waitUntil: 'domcontentloaded' });
  await expect(page.getByTestId('loads')).toHaveText('loaded');
  await expect(page.getByTestId('hangs')).toHaveText('timeout');
  // Far below the fold: the browser hasn't started loading it, so no time is counted.
  await page.waitForTimeout(1_500);
  await expect(page.getByTestId('lazy')).toHaveText('loading');
  await page.getByTestId('lazy').scrollIntoViewIfNeeded();
  await expect(page.getByTestId('lazy')).toHaveText('timeout');
});
