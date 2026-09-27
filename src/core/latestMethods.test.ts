import { describe, expect, it } from 'vitest';
import { IframeKitError } from './errors';
import { latestMethods } from './latestMethods';

describe('latestMethods', () => {
  it('calls the latest function for each name, with this === undefined', () => {
    let seenThis: unknown = 'unset';
    const ref: { current: { methods?: object } } = {
      current: { methods: { greet: () => 'old' } },
    };
    const wrappers = latestMethods(ref);
    ref.current = {
      methods: {
        greet(this: unknown, name: unknown) {
          seenThis = this;
          return `hi ${name}`;
        },
      },
    };
    expect(wrappers['greet']?.('ann')).toBe('hi ann');
    expect(seenThis).toBeUndefined();
  });

  it('skips non-function entries and handles missing methods', () => {
    expect(Object.keys(latestMethods({ current: { methods: { x: 1, y: () => 1 } } }))).toEqual([
      'y',
    ]);
    expect(latestMethods({ current: {} })).toEqual({});
  });

  it('throws RIK_METHOD_NOT_FOUND once a method is removed', () => {
    const ref: { current: { methods?: object } } = { current: { methods: { x: () => 1 } } };
    const wrappers = latestMethods(ref);
    for (const next of [{ methods: {} }, {}]) {
      ref.current = next;
      try {
        wrappers['x']?.();
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(IframeKitError);
        expect((error as IframeKitError).code).toBe('RIK_METHOD_NOT_FOUND');
      }
    }
  });
});
