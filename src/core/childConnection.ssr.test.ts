// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { connectToParent } from './childConnection';

// docs/design.md → SSR: `connectToParent` on the server is a no-op that stays idle.
describe('connectToParent on the server', () => {
  it('stays idle and does not touch window or document', () => {
    expect(typeof window).toBe('undefined');
    const handle = connectToParent({ allowedOrigins: ['https://example.com'] });
    expect(handle.status).toBe('idle');
  });

  it('autoResize is a no-op (no document to measure)', () => {
    expect(() =>
      connectToParent({ allowedOrigins: ['https://example.com'], autoResize: true }),
    ).not.toThrow();
  });

  it('dispose is a no-op', () => {
    const handle = connectToParent({ allowedOrigins: ['https://example.com'] });
    expect(() => handle.dispose()).not.toThrow();
  });
});
