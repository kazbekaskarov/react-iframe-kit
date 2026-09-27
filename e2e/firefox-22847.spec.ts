import { expect, test } from '@playwright/test';

// facebook/react#22847: content portaled into an iframe is lost when the iframe's
// document is replaced after React has mounted into it.
//
// Findings (2026-09-27, docs/design.md → Portal mode):
// - Firefox ≤ 146 replaces the initial about:blank of an iframe without `src` on load;
//   fixed in Firefox 147/148. The Firefox bundled with current Playwright no longer
//   shows it, so these tests force a document replacement with `srcdoc` instead,
//   which replaces the document in every browser.

async function loadVariant(page: import('@playwright/test').Page, variant: string) {
  await page.goto(`/firefox-22847.html?variant=${variant}`);
  await page.waitForFunction(
    () => document.querySelector('iframe')?.contentDocument?.readyState === 'complete',
  );
  // Leave time for any late document swap.
  await page.waitForTimeout(300);
  return page.frameLocator('iframe[title="frame"]').getByTestId('portal-content');
}

test('mounting after the native load of the final document keeps the content', async ({ page }) => {
  await expect(await loadVariant(page, 'srcdoc-load')).toBeVisible();
});

test('mounting before the document is replaced loses the content (the bug)', async ({ page }) => {
  // Canary: if a browser ever keeps the pre-load document, this starts failing and
  // the design assumptions need another look.
  await expect(await loadVariant(page, 'srcdoc-naive')).toHaveCount(0);
});
