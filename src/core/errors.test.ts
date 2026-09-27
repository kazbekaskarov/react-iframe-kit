import { describe, expect, it } from 'vitest';
import { IframeKitError, isIframeKitError, RemoteError, TimeoutError } from './errors';

// Simulates an error created by another copy of the library: same brand, different class.
function foreignError(code: string, name = 'IframeKitError'): Error {
  const error = new Error('from another copy');
  error.name = name;
  Object.defineProperty(error, Symbol.for('react-iframe-kit/error'), { value: true });
  Object.assign(error, { code });
  return error;
}

describe('IframeKitError', () => {
  it('carries a code, name, message and cause', () => {
    const cause = new Error('inner');
    const error = new IframeKitError('RIK_DESTROYED', 'disposed', { cause });

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(IframeKitError);
    expect(error.name).toBe('IframeKitError');
    expect(error.code).toBe('RIK_DESTROYED');
    expect(error.message).toBe('disposed');
    expect(error.cause).toBe(cause);
  });

  it('does not expose the brand as an enumerable property', () => {
    const error = new IframeKitError('RIK_DESTROYED', 'x');
    const brand = Object.getOwnPropertyDescriptor(error, Symbol.for('react-iframe-kit/error'));

    expect(brand).toMatchObject({ value: true, enumerable: false, writable: false });
  });

  it('recognizes errors from other library copies', () => {
    const error = foreignError('RIK_TIMEOUT', 'TimeoutError');

    expect(error).toBeInstanceOf(IframeKitError);
    expect(error).toBeInstanceOf(TimeoutError);
    expect(error).not.toBeInstanceOf(RemoteError);
    expect(isIframeKitError(error)).toBe(true);
  });

  it('rejects values without the brand or with a malformed code', () => {
    for (const value of [null, undefined, 'RIK_TIMEOUT', {}, new Error('plain')]) {
      expect(value).not.toBeInstanceOf(IframeKitError);
      expect(isIframeKitError(value)).toBe(false);
    }
    const malformed = foreignError('RIK_TIMEOUT');
    Object.assign(malformed, { code: 42 });
    expect(isIframeKitError(malformed)).toBe(false);
  });
});

describe('RemoteError', () => {
  it('keeps the remote error as cause', () => {
    const remote = { name: 'ValidationError', message: 'bad input', code: 'E_INPUT' };
    const error = new RemoteError(remote);

    expect(error).toBeInstanceOf(RemoteError);
    expect(error).toBeInstanceOf(IframeKitError);
    expect(error).not.toBeInstanceOf(TimeoutError);
    expect(error.name).toBe('RemoteError');
    expect(error.code).toBe('RIK_REMOTE_ERROR');
    expect(error.message).toBe('bad input');
    expect(error.cause).toBe(remote);
  });
});

describe('TimeoutError', () => {
  it('records the phase', () => {
    const error = new TimeoutError('connect', 'not connected within 30000 ms');

    expect(error).toBeInstanceOf(TimeoutError);
    expect(error.name).toBe('TimeoutError');
    expect(error.code).toBe('RIK_TIMEOUT');
    expect(error.phase).toBe('connect');
  });
});
