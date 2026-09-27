import { describe, expect, it } from 'vitest';
import { extractTransferables, transfer } from './transfer';

describe('transfer / extractTransferables', () => {
  it('unwraps a bare transfer()-wrapped value', () => {
    const buffer = new ArrayBuffer(8);
    const wrapped = transfer(buffer, [buffer]);
    expect(extractTransferables(wrapped)).toEqual({ value: buffer, transferables: [buffer] });
  });

  it('unwraps transfer()-wrapped elements inside an array, collecting transferables', () => {
    const a = new ArrayBuffer(1);
    const b = new ArrayBuffer(2);
    const result = extractTransferables([transfer(a, [a]), 'plain', transfer(b, [b])]);
    expect(result).toEqual({ value: [a, 'plain', b], transferables: [a, b] });
  });

  it('passes a plain array through unchanged, with no transferables', () => {
    expect(extractTransferables([1, 2, 3])).toEqual({ value: [1, 2, 3], transferables: [] });
  });

  it('passes a plain (non-array, non-wrapped) value through unchanged', () => {
    expect(extractTransferables({ a: 1 })).toEqual({ value: { a: 1 }, transferables: [] });
    expect(extractTransferables(null)).toEqual({ value: null, transferables: [] });
  });
});
