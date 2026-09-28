// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { connectToParent } from './connectToParent';

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

  it('syncTitle is a no-op, and so is disposing it', () => {
    const handle = connectToParent({ allowedOrigins: ['https://example.com'], syncTitle: true });
    expect(() => handle.dispose()).not.toThrow();
  });

  it('dispose is a no-op', () => {
    const handle = connectToParent({ allowedOrigins: ['https://example.com'] });
    expect(() => handle.dispose()).not.toThrow();
  });
});
