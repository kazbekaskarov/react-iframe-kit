import { expect, type Frame, type Page, test } from '@playwright/test';
import { watchConsoleErrors } from './console';

// useIframeInert in real browsers. `inert` on the <iframe> alone blocks clicks and Tab,
// but in Chromium and WebKit keys still reach an element focused inside before, or one
// the page focuses itself; the page inside must be made inert too. See docs/design.md →
// Inert.

function embedded(page: Page): Frame {
  const frame = page.frames().find((f) => f !== page.mainFrame());
  if (!frame) throw new Error('no iframe');
  return frame;
}

const setInert = (page: Page, value: boolean) =>
  page.evaluate((v) => (window as unknown as { setInert(v: boolean): void }).setInert(v), value);

const value = (page: Page) =>
  embedded(page).evaluate(() => (document.getElementById('inner') as HTMLInputElement).value);
const clicks = (page: Page) =>
  embedded(page).evaluate(() => document.getElementById('clicks')?.textContent);

for (const mode of ['cross', 'frame']) {
  test(`${mode === 'cross' ? 'a cross-origin page running connectToParent' : 'a same-origin <Frame>'} can't be clicked, focused or typed into while inert`, async ({
    page,
  }) => {
    const noConsoleErrors = watchConsoleErrors(page);
    await page.goto(`/inert-host.html?mode=${mode}`);
    const iframe = page.locator('iframe[title="embed"]');
    const inside = page.frameLocator('iframe[title="embed"]');
    await expect(inside.locator('#inner')).toBeVisible();
    if (mode === 'cross')
      await expect(inside.locator('body')).toHaveAttribute('data-connected', 'true');

    // Focus is inside when it turns on.
    await inside.locator('#inner').click();
    await setInert(page, true);
    await expect(page.getByTestId('inert')).toHaveText('true');
    await expect(iframe).toHaveAttribute('inert', '');
    await expect(inside.locator('body')).toHaveAttribute('inert', '');
    await page.keyboard.type('a');

    // Clicking, tabbing in, and the page focusing itself.
    const box = await iframe.boundingBox();
    if (!box) throw new Error('no box');
    await page.mouse.click(box.x + 20, box.y + 35); // the button
    await page.locator('#before').focus();
    await page.keyboard.press('Tab');
    await expect(page.locator('#after')).toBeFocused();
    await embedded(page).evaluate(() => (document.getElementById('inner') as HTMLElement).focus());
    await page.keyboard.type('b');

    expect(await value(page)).toBe('');
    expect(await clicks(page)).toBe('0');

    // And all of it works again once it's off. Not checked with the keyboard: in Firefox
    // under Playwright, keys never reach an iframe clicked after a parent input had
    // focus, inert or not. `fill` needs the input to be focusable and editable.
    await setInert(page, false);
    await expect(iframe).not.toHaveAttribute('inert');
    await expect(inside.locator('body')).not.toHaveAttribute('inert');
    await inside.locator('#button').click();
    await expect(inside.locator('#clicks')).toHaveText('1');
    await inside.locator('#inner').fill('c');
    expect(await value(page)).toBe('c');
    noConsoleErrors();
  });
}
