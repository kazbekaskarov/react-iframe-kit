import { expect, it } from 'vitest';
import { connectToParent } from '../core/connectToParent';
import { mockParent } from './mockParent';

// Its own file: it needs a page connection that was first made while the page wasn't
// framed, which the shared cases' connection (framed from the first test on) isn't.
it('replaces a page connection made before the page was framed', async () => {
  const early = connectToParent({ allowedOrigins: [location.origin] });
  expect(early.status).toBe('idle');

  const parent = mockParent();
  const page = connectToParent({ allowedOrigins: [location.origin] });
  await parent.whenConnected();
  await page.whenConnected();
  expect(page.status).toBe('connected');
  expect(early.status).toBe('idle'); // still bound to the unframed connection

  page.dispose();
  early.dispose();
  parent.dispose();
});
