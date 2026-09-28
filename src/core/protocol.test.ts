import { describe, expect, it } from 'vitest';
import {
  highestCommonVersion,
  parsePortMessage,
  parseWindowMessage,
  RIK,
  SUPPORTED_VERSIONS,
} from './protocol';

describe('RIK / SUPPORTED_VERSIONS', () => {
  it('is fixed at 1', () => {
    expect(RIK).toBe(1);
    expect(SUPPORTED_VERSIONS).toContain(1);
  });
});

describe('parseWindowMessage', () => {
  it('parses the child syn (with instance)', () => {
    expect(parseWindowMessage({ rik: 1, type: 'syn', instance: 'abc', versions: [1] })).toEqual({
      rik: 1,
      type: 'syn',
      instance: 'abc',
      versions: [1],
    });
  });

  it('parses the parent prompt syn (without instance)', () => {
    expect(parseWindowMessage({ rik: 1, type: 'syn', versions: [1] })).toEqual({
      rik: 1,
      type: 'syn',
      instance: undefined,
      versions: [1],
    });
  });

  it('parses ack', () => {
    expect(
      parseWindowMessage({ rik: 1, type: 'ack', session: 's', instance: 'i', version: 1 }),
    ).toEqual({
      rik: 1,
      type: 'ack',
      session: 's',
      instance: 'i',
      version: 1,
    });
  });

  it.each([
    ['not an object', 'hello'],
    ['null', null],
    ['no rik', { type: 'syn', versions: [1] }],
    ['wrong rik', { rik: 2, type: 'syn', versions: [1] }],
    ['no type', { rik: 1, versions: [1] }],
    ['unknown type', { rik: 1, type: 'call', method: 'x' }],
    ['syn without versions', { rik: 1, type: 'syn' }],
    ['syn with empty versions', { rik: 1, type: 'syn', versions: [] }],
    ['syn with non-integer versions', { rik: 1, type: 'syn', versions: [1.5] }],
    ['syn with non-array versions', { rik: 1, type: 'syn', versions: '1' }],
    ['syn with non-string instance', { rik: 1, type: 'syn', instance: 42, versions: [1] }],
    ['ack without session', { rik: 1, type: 'ack', instance: 'i', version: 1 }],
    ['ack without instance', { rik: 1, type: 'ack', session: 's', version: 1 }],
    ['ack without version', { rik: 1, type: 'ack', session: 's', instance: 'i' }],
    [
      'ack with non-numeric version',
      { rik: 1, type: 'ack', session: 's', instance: 'i', version: '1' },
    ],
  ])('rejects %s', (_name, data) => {
    expect(parseWindowMessage(data)).toBeNull();
  });
});

describe('parsePortMessage', () => {
  it('parses ready', () => {
    expect(parsePortMessage({ rik: 1, type: 'ready' })).toEqual({ rik: 1, type: 'ready' });
  });

  it('parses bye', () => {
    expect(parsePortMessage({ rik: 1, type: 'bye' })).toEqual({ rik: 1, type: 'bye' });
  });

  it('parses size without loop', () => {
    expect(parsePortMessage({ rik: 1, type: 'size', width: 10, height: 20 })).toEqual({
      rik: 1,
      type: 'size',
      width: 10,
      height: 20,
      loop: undefined,
    });
  });

  it('parses size with loop', () => {
    expect(
      parsePortMessage({ rik: 1, type: 'size', width: 10, height: 20, loop: true }),
    ).toMatchObject({
      loop: true,
    });
  });

  it.each([
    ['not an object', 42],
    ['wrong rik', { rik: 2, type: 'size', width: 1, height: 1 }],
    ['unknown type', { rik: 1, type: 'foo' }],
    ['size with negative width', { rik: 1, type: 'size', width: -1, height: 1 }],
    [
      'size with Infinity height',
      { rik: 1, type: 'size', width: 1, height: Number.POSITIVE_INFINITY },
    ],
    ['size with NaN width', { rik: 1, type: 'size', width: Number.NaN, height: 1 }],
    ['size with non-numeric width', { rik: 1, type: 'size', width: '1', height: 1 }],
    ['size with non-boolean loop', { rik: 1, type: 'size', width: 1, height: 1, loop: 'yes' }],
  ])('rejects %s', (_name, data) => {
    expect(parsePortMessage(data)).toBeNull();
  });

  it('parses call', () => {
    expect(
      parsePortMessage({ rik: 1, type: 'call', id: 'c1', method: 'greet', args: ['a', 1] }),
    ).toEqual({ rik: 1, type: 'call', id: 'c1', method: 'greet', args: ['a', 1] });
  });

  it.each([
    ['call without id', { rik: 1, type: 'call', method: 'x', args: [] }],
    ['call without method', { rik: 1, type: 'call', id: 'c1', args: [] }],
    ['call with non-array args', { rik: 1, type: 'call', id: 'c1', method: 'x', args: 'nope' }],
  ])('rejects %s', (_name, data) => {
    expect(parsePortMessage(data)).toBeNull();
  });

  it('parses a successful result', () => {
    expect(parsePortMessage({ rik: 1, type: 'result', id: 'c1', ok: true, value: 42 })).toEqual({
      rik: 1,
      type: 'result',
      id: 'c1',
      ok: true,
      value: 42,
    });
  });

  it('parses a failed result with a well-formed error', () => {
    const error = { name: 'Error', message: 'boom', code: 'E_X', data: { a: 1 }, stack: 's' };
    expect(parsePortMessage({ rik: 1, type: 'result', id: 'c1', ok: false, error })).toEqual({
      rik: 1,
      type: 'result',
      id: 'c1',
      ok: false,
      error,
    });
  });

  it.each([
    ['result without id', { rik: 1, type: 'result', ok: true, value: 1 }],
    ['result with non-boolean ok', { rik: 1, type: 'result', id: 'c1', ok: 'yes' }],
    [
      'failed result with a non-object error',
      { rik: 1, type: 'result', id: 'c1', ok: false, error: 'x' },
    ],
    ['failed result with null error', { rik: 1, type: 'result', id: 'c1', ok: false, error: null }],
    [
      'failed result with an error missing name',
      { rik: 1, type: 'result', id: 'c1', ok: false, error: { message: 'x' } },
    ],
    [
      'failed result with an error missing message',
      { rik: 1, type: 'result', id: 'c1', ok: false, error: { name: 'Error' } },
    ],
    [
      'failed result with an error whose code is neither a string nor a number',
      {
        rik: 1,
        type: 'result',
        id: 'c1',
        ok: false,
        error: { name: 'Error', message: 'x', code: {} },
      },
    ],
    [
      'failed result with an error whose stack is not a string',
      {
        rik: 1,
        type: 'result',
        id: 'c1',
        ok: false,
        error: { name: 'Error', message: 'x', stack: 1 },
      },
    ],
  ])('rejects %s', (_name, data) => {
    expect(parsePortMessage(data)).toBeNull();
  });

  it('parses a failed result error with a numeric code and no data or stack', () => {
    expect(
      parsePortMessage({
        rik: 1,
        type: 'result',
        id: 'c1',
        ok: false,
        error: { name: 'Error', message: 'x', code: 404 },
      }),
    ).toEqual({
      rik: 1,
      type: 'result',
      id: 'c1',
      ok: false,
      error: { name: 'Error', message: 'x', code: 404 },
    });
  });

  it('parses a failed result error with no code, data or stack', () => {
    expect(
      parsePortMessage({
        rik: 1,
        type: 'result',
        id: 'c1',
        ok: false,
        error: { name: 'Error', message: 'x' },
      }),
    ).toEqual({
      rik: 1,
      type: 'result',
      id: 'c1',
      ok: false,
      error: { name: 'Error', message: 'x' },
    });
  });

  it('parses event with and without payload', () => {
    expect(parsePortMessage({ rik: 1, type: 'event', name: 'tick' })).toEqual({
      rik: 1,
      type: 'event',
      name: 'tick',
      payload: undefined,
    });
    expect(parsePortMessage({ rik: 1, type: 'event', name: 'tick', payload: { n: 1 } })).toEqual({
      rik: 1,
      type: 'event',
      name: 'tick',
      payload: { n: 1 },
    });
  });

  it('parses title', () => {
    expect(parsePortMessage({ rik: 1, type: 'title', title: 'Checkout', extra: 1 })).toEqual({
      rik: 1,
      type: 'title',
      title: 'Checkout',
    });
  });

  it('rejects title with a non-string title', () => {
    expect(parsePortMessage({ rik: 1, type: 'title', title: 42 })).toBeNull();
    expect(parsePortMessage({ rik: 1, type: 'title' })).toBeNull();
  });

  it('rejects event with a non-string name', () => {
    expect(parsePortMessage({ rik: 1, type: 'event', name: 42 })).toBeNull();
  });
});

describe('highestCommonVersion', () => {
  it('returns the highest version present in both lists', () => {
    expect(highestCommonVersion([1, 2, 3], [2, 3, 4])).toBe(3);
  });

  it('returns undefined when there is no overlap', () => {
    expect(highestCommonVersion([1], [2])).toBeUndefined();
  });

  it('handles single-element lists', () => {
    expect(highestCommonVersion([1], [1])).toBe(1);
  });
});
