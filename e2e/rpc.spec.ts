import { expect, test } from '@playwright/test';

// Real cross-origin RPC and events: two dev-server ports, React hooks on both sides
// (`useIframeRPC`/`useIframeEvent` in the parent, `useParent`/`useParentEvent` in the
// child). See docs/design.md → RPC and events API.

// Both fixtures render in StrictMode: its simulated unmount/remount must not reject
// the calls their mount effects make (an unhandled rejection would land here).
const pageErrors: Error[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (error) => pageErrors.push(error));
  await page.goto('/rpc-host.html');
  await expect(page.getByTestId('status')).toHaveText('connected');
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('a call made while the parent hook was still idle waits and succeeds', async ({ page }) => {
  await expect(page.getByTestId('early')).toHaveText('early');
});

test('the child calls the parent right away and gets an answer', async ({ page }) => {
  const child = page.frameLocator('iframe[title="frame"]');
  await expect(child.getByTestId('status')).toHaveText('connected');
  await expect(child.getByTestId('user')).toHaveText('ann');
});

test('parent to child calls resolve, and errors arrive as RemoteError', async ({ page }) => {
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('result')).toHaveText('5');
  await page.getByRole('button', { name: 'fail' }).click();
  await expect(page.getByTestId('result')).toHaveText('RemoteError:E_NOPE');
});

test('the child page title reaches useIframeTitle, and follows changes', async ({ page }) => {
  await expect(page.getByTestId('child-title')).toHaveText('react-iframe-kit e2e: RPC child');
  const child = page.frameLocator('iframe[title="frame"]');
  await child.getByRole('button', { name: 'rename' }).click();
  await expect(page.getByTestId('child-title')).toHaveText('Renamed child');
});

test('connectReduxDevTools sends the real traffic to the extension', async ({ page }) => {
  await page.addInitScript(() => {
    const actions: string[] = [];
    Object.assign(window, {
      devtoolsActions: actions,
      __REDUX_DEVTOOLS_EXTENSION__: {
        connect: () => ({
          init() {},
          send: (action: { type: string }) => actions.push(action.type),
        }),
      },
    });
  });
  await page.reload();
  await expect(page.getByTestId('status')).toHaveText('connected');
  await page.getByRole('button', { name: 'add' }).click();
  await expect(page.getByTestId('result')).toHaveText('5');

  const actions = await page.evaluate(
    () => (window as unknown as { devtoolsActions: string[] }).devtoolsActions,
  );
  expect(actions).toEqual(
    expect.arrayContaining([
      '← syn',
      '→ ack',
      '← ready',
      expect.stringMatching(/^→ call add #\w{6}$/),
      expect.stringMatching(/^← result #\w{6} ok$/),
    ]),
  );
});

test('events flow both ways', async ({ page }) => {
  const child = page.frameLocator('iframe[title="frame"]');
  await page.getByRole('button', { name: 'dark' }).click();
  await expect(child.getByTestId('theme')).toHaveText('dark');
  await child.getByRole('button', { name: 'submit' }).click();
  await expect(page.getByTestId('submitted')).toHaveText('42');
});

test('the default timeout rejects a slow call; timeout: Infinity lets one through', async ({
  page,
}) => {
  const child = page.frameLocator('iframe[title="frame"]');
  await expect(child.getByTestId('slow')).toHaveText('RIK_TIMEOUT');
  await expect(child.getByTestId('unbounded')).toHaveText('done');
});
