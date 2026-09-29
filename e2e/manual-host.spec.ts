import { expect, type Page, test } from '@playwright/test';
import { watchConsoleErrors } from './console';

// Conformance: a host written by hand from the docs' protocol page, with no library
// code (fixtures/connect-widget.js), against the library's real cross-origin widget.
// If a change to the library breaks it, it breaks every integration written from those
// docs, so wire protocol v1 is held to it. See docs/design.md → Wire protocol, Stability.

function widget(page: Page) {
  const frame = page.frames().find((f) => f.url().includes('host-vanilla-child.html'));
  if (!frame) throw new Error('the widget frame is missing');
  return frame;
}

type WidgetWindow = { addLine(): void; callHost(method: string, ...args: unknown[]): string };

test('connects, sizes, syncs the title, and calls and sends events both ways', async ({ page }) => {
  const noConsoleErrors = watchConsoleErrors(page);
  await page.goto('/manual-host.html');
  await expect(page.getByTestId('status')).toHaveText('connected');

  const iframe = page.locator('iframe');
  await expect(iframe).toHaveAttribute('title', 'Checkout');
  const content = await widget(page).evaluate(() =>
    Math.ceil(document.documentElement.getBoundingClientRect().height),
  );
  await expect(iframe).toHaveJSProperty('clientHeight', content);
  await widget(page).evaluate(() => (window as unknown as WidgetWindow).addLine());
  await expect
    .poll(() => iframe.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(content);

  // Host → widget: a call, and an event.
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('result')).toHaveText('5');
  await page.getByRole('button', { name: 'theme' }).click();
  await expect
    .poll(() => widget(page).evaluate(() => document.documentElement.dataset['theme']))
    .toBe('dark');

  // Widget → host: a call on start, and an event.
  await expect(page.frameLocator('iframe').getByTestId('user')).toHaveText('user 7');
  await page.frameLocator('iframe').getByRole('button', { name: 'submit' }).click();
  await expect(page.getByTestId('events')).toHaveText('submitted {"id":"42"}');
  noConsoleErrors();
});

test('carries errors both ways in the shape each side expects', async ({ page }) => {
  await page.goto('/manual-host.html');
  await expect(page.getByTestId('status')).toHaveText('connected');

  await page.getByRole('button', { name: 'missing' }).click();
  await expect(page.getByTestId('error')).toHaveText(
    'IframeKitError RIK_METHOD_NOT_FOUND: no method named "missing"',
  );

  const callHost = (method: string) =>
    widget(page).evaluate((name) => (window as unknown as WidgetWindow).callHost(name), method);
  expect(await callHost('fail')).toBe('RemoteError CARD_DECLINED: declined');
  expect(await callHost('nope')).toBe('RemoteError RIK_METHOD_NOT_FOUND: no method named "nope"');
});

test('connects to a widget that started before the host did', async ({ page }) => {
  await page.goto('/manual-host.html?late');
  await expect(page.getByTestId('status')).toHaveText('connected');
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('result')).toHaveText('5');
});

test('starts a new session when the widget reloads', async ({ page }) => {
  await page.goto('/manual-host.html');
  await expect(page.getByTestId('connects')).toHaveText('1');
  await expect(page.frameLocator('iframe').getByTestId('user')).toHaveText('user 7');

  await widget(page).evaluate(() => setTimeout(() => location.reload()));
  await expect(page.getByTestId('connects')).toHaveText('2');
  await expect(page.getByTestId('status')).toHaveText('connected');
  await expect(page.frameLocator('iframe').getByTestId('user')).toHaveText('user 7');
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('result')).toHaveText('5');
});

test('makes the widget inert, inside and out', async ({ page }) => {
  await page.goto('/manual-host.html');
  await expect(page.getByTestId('status')).toHaveText('connected');
  await page.getByRole('button', { name: 'inert' }).click();
  await expect(page.locator('iframe')).toHaveAttribute('inert', '');
  await expect
    .poll(() => widget(page).evaluate(() => document.body.hasAttribute('inert')))
    .toBe(true);
  await page.getByRole('button', { name: 'inert' }).click();
  await expect
    .poll(() => widget(page).evaluate(() => document.body.hasAttribute('inert')))
    .toBe(false);
});
