import { describe, expect, it, vi } from 'vitest';
import { createRemote, withOptions } from './remote';

describe('createRemote', () => {
  it('caches a function per method name (stable identity)', () => {
    const remote = createRemote(() => Promise.resolve());
    expect(remote['x']).toBe(remote['x']);
  });

  it('calls through with the method name and arguments', () => {
    const call = vi.fn(() => Promise.resolve('ok'));
    const remote = createRemote(call);
    void remote['greet']?.('a', 'b');
    expect(call).toHaveBeenCalledWith('greet', ['a', 'b']);
  });

  it('hides then, toJSON and symbol keys', () => {
    const remote = createRemote(() => Promise.resolve());
    expect(remote['then']).toBeUndefined();
    expect(remote['toJSON']).toBeUndefined();
    expect((remote as unknown as Record<symbol, unknown>)[Symbol.iterator]).toBeUndefined();
  });
});

describe('withOptions', () => {
  it('passes the options through to the underlying call', () => {
    const call = vi.fn(() => Promise.resolve());
    const remote = createRemote(call);
    const signal = new AbortController().signal;
    void withOptions(remote['x'] as (...a: unknown[]) => Promise<unknown>, { timeout: 5, signal })(
      'a',
    );
    expect(call).toHaveBeenCalledWith('x', ['a'], { timeout: 5, signal });
  });
});
