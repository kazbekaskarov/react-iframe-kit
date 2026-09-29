import { afterEach, describe, expect, it, vi } from 'vitest';
import { type StandardSchemaV1, validateArgs, validatePayload } from './validate';

/** A tiny Standard Schema, as Zod/Valibot/ArkType would provide. */
function schema<Output>(
  test: (value: unknown) => StandardSchemaV1.Result<Output>,
  async = false,
): StandardSchemaV1<unknown, Output> {
  return {
    '~standard': {
      version: 1,
      vendor: 'test',
      validate: (value) => (async ? Promise.resolve(test(value)) : test(value)),
    },
  };
}

const positiveAmount = schema<[number]>((value) => {
  const [amount] = value as unknown[];
  return typeof amount === 'number' && amount > 0
    ? { value: [Math.round(amount)] }
    : { issues: [{ message: 'must be a positive number', path: [0] }] };
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('validateArgs', () => {
  it('calls the method with the schema output', async () => {
    const pay = validateArgs(positiveAmount, (amount) => `paid ${amount}`);
    await expect(pay(9.6)).resolves.toBe('paid 10');
  });

  it('rejects invalid arguments with RIK_VALIDATION and plain issues in data', async () => {
    const method = vi.fn();
    const pay = validateArgs(positiveAmount, method);
    await expect(pay(-1)).rejects.toMatchObject({
      code: 'RIK_VALIDATION',
      message: 'react-iframe-kit: invalid arguments: must be a positive number',
      data: [{ message: 'must be a positive number', path: ['0'] }],
    });
    expect(method).not.toHaveBeenCalled();
  });

  it('works with async schemas, and path segments given as objects or not at all', async () => {
    const nested = schema<[{ email: string }]>(
      () => ({
        issues: [
          { message: 'bad email', path: [0, { key: 'email' }] },
          { message: 'something else' },
        ],
      }),
      true,
    );
    await expect(validateArgs(nested, (_user) => {})({ email: 'x' })).rejects.toMatchObject({
      data: [{ message: 'bad email', path: ['0', 'email'] }, { message: 'something else' }],
    });
  });
});

describe('validatePayload', () => {
  const order = schema<{ id: string }>((value) =>
    typeof (value as { id?: unknown }).id === 'string'
      ? { value: value as { id: string } }
      : { issues: [{ message: 'id is required', path: ['id'] }] },
  );

  it('delivers a valid payload', async () => {
    const handler = vi.fn();
    validatePayload(order, handler)({ id: '42' });
    await vi.waitFor(() => expect(handler).toHaveBeenCalledWith({ id: '42' }));
  });

  it('drops an invalid payload and reports the error', async () => {
    const report = vi.fn();
    vi.stubGlobal('reportError', report);
    const handler = vi.fn();
    validatePayload(order, handler)({} as { id: string });
    await vi.waitFor(() =>
      expect(report).toHaveBeenCalledWith(expect.objectContaining({ code: 'RIK_VALIDATION' })),
    );
    expect(handler).not.toHaveBeenCalled();
  });

  it('falls back to console.error without reportError', async () => {
    vi.stubGlobal('reportError', undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    validatePayload(order, () => {})({} as { id: string });
    await vi.waitFor(() =>
      expect(error).toHaveBeenCalledWith(expect.objectContaining({ code: 'RIK_VALIDATION' })),
    );
  });
});
