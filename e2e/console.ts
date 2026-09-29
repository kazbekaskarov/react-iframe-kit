import { expect, type Page } from '@playwright/test';

/**
 * Collects console errors and uncaught exceptions from the page and its iframes, and
 * returns the check to call at the end of the test. An embed must not cost the host
 * page errors: WebKit, for one, logs a security error for every read of another origin's
 * `contentDocument`, even a caught one.
 */
export function watchConsoleErrors(page: Page): () => void {
  const errors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', (error) => errors.push(error.message));
  return () => expect(errors, 'console errors').toEqual([]);
}
