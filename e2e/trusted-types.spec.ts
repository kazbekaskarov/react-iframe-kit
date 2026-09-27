import { expect, type Page, test } from '@playwright/test';
import { TRUSTED_TYPES_CSP } from './trusted-types-csp';

// <Frame> on a page that enforces Trusted Types. `srcdoc` is a TrustedHTML sink, and
// every engine enforces it now. See docs/design.md → Trusted Types.

const GREEN = 'rgb(0, 128, 0)';
/** Start of the error `useIframe` logs for a blocked srcdoc; the fix it names follows. */
const BLOCKED = "RIK_INVALID_OPTIONS: react-iframe-kit: the page blocked the iframe's srcdoc.";

/**
 * Console errors as text. Error objects are read from the arguments: Firefox's console
 * text for them is just "Error". An IframeKitError reads as "<code>: <message>".
 */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', async (message) => {
    if (message.type() !== 'error') return;
    const args = await Promise.all(
      message
        .args()
        .map((arg) =>
          arg
            .evaluate((value) =>
              value instanceof Error
                ? `${(value as { code?: string }).code ?? value.name}: ${value.message}`
                : String(value),
            )
            .catch(() => ''),
        ),
    );
    errors.push(args.join(' ') || message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function open(page: Page, name: string) {
  const response = await page.goto(`/trusted-types.html?case=${name}`);
  expect(response?.headers()['content-security-policy']).toBe(TRUSTED_TYPES_CSP[name]);
}

const frame = (page: Page) => page.frameLocator('iframe[title="frame"]');

for (const name of ['enforced', 'allowlisted']) {
  test(`renders, copies styles and resizes (${name})`, async ({ page }) => {
    const errors = consoleErrors(page);
    await open(page, name);

    const content = frame(page).getByTestId('content');
    await expect(content).toHaveText('rendered under Trusted Types');
    await expect(content).toHaveCSS('color', GREEN);
    await expect
      .poll(() =>
        page.locator('iframe[title="frame"]').evaluate((iframe: HTMLIFrameElement) => {
          const root = iframe.contentDocument?.documentElement;
          return root
            ? iframe.clientHeight === Math.ceil(root.getBoundingClientRect().height)
            : false;
        }),
      )
      .toBe(true);
    expect(errors).toEqual([]);
  });
}

test('reports a refused policy instead of taking down the host app', async ({ page }) => {
  const errors = consoleErrors(page);
  await open(page, 'refused');

  await expect
    .poll(() => errors)
    .toContain(`${BLOCKED} Allow the "react-iframe-kit" policy in \`trusted-types\`.`);
  await expect(page.getByTestId('host')).toHaveText('host app');
  await expect(page.locator('iframe[title="frame"]')).toBeAttached();
});

test('loads a custom srcDoc given as TrustedHTML', async ({ page }) => {
  const errors = consoleErrors(page);
  await open(page, 'custom-trusted');

  await expect(frame(page).locator('#custom')).toHaveText('custom document');
  expect(errors).toEqual([]);
});

test('reports a custom srcDoc string the page blocks', async ({ page }) => {
  const errors = consoleErrors(page);
  await open(page, 'custom-string');

  await expect.poll(() => errors).toContain(`${BLOCKED} Pass \`srcDoc\` as a TrustedHTML.`);
  await expect(page.getByTestId('host')).toHaveText('host app');
});
