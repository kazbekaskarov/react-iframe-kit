import { afterEach, describe, expect, it } from 'vitest';
import { getRegistry } from './registry';

const KEY = Symbol.for('react-iframe-kit/v1');

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[KEY];
});

describe('getRegistry', () => {
  it('creates the registry once and returns the same object afterwards', () => {
    const registry = getRegistry();
    expect(getRegistry()).toBe(registry);
    expect((globalThis as Record<symbol, unknown>)[KEY]).toBe(registry);
  });

  it('reuses a registry created by another library copy', () => {
    const fromOtherCopy = { frameContext: 'context from another copy' };
    (globalThis as Record<symbol, unknown>)[KEY] = fromOtherCopy;
    expect(getRegistry()).toBe(fromOtherCopy);
  });
});
