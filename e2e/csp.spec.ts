import { expect, test } from '@playwright/test';

// `copyStyles` under a host Content Security Policy of `style-src 'nonce-…'`. A
// `<Frame>` document is a srcdoc document and inherits the host's policy, so mirrored
// styles only apply if cloning kept each element's nonce. See docs/design.md →
// `<Frame>`, and the security guide on the docs site.

const GREEN = 'rgb(0, 128, 0)';
const RED = 'rgb(255, 0, 0)';

test('copied styles keep their nonce, and the inherited policy still blocks the rest', async ({
  page,
}) => {
  const response = await page.goto('/csp-frame.html');
  expect(response?.headers()['content-security-policy']).toBe("style-src 'nonce-rik-e2e'");

  // The policy is really in force on the host: nonce'd style applies, the other doesn't.
  await expect(page.getByTestId('parent-probe')).toHaveCSS('color', GREEN);
  await expect(page.getByTestId('parent-canary')).not.toHaveCSS('color', RED);

  const frame = page.frameLocator('iframe[title="frame"]');
  await expect(frame.locator('.probe')).toHaveCSS('color', GREEN);
  await expect(frame.locator('.canary')).not.toHaveCSS('color', RED);
});
