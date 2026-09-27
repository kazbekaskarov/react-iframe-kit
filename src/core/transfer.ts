/**
 * `transfer(value, transferables)`: marks part of a call argument, return value or
 * event payload for `postMessage`'s transfer list. See docs/design.md → Port messages.
 */

const TRANSFER: unique symbol = Symbol.for('react-iframe-kit/transfer');

interface TransferWrapper {
  [TRANSFER]: true;
  value: unknown;
  transferables: readonly Transferable[];
}

export function transfer<T>(value: T, transferables: readonly Transferable[]): T {
  const wrapper: TransferWrapper = { [TRANSFER]: true, value, transferables };
  // Branded as `T` for the caller; unwrapped back to `{ value, transferables }`
  // right before `postMessage` (`extractTransferables`).
  return wrapper as unknown as T;
}

function isTransferWrapper(value: unknown): value is TransferWrapper {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[TRANSFER] === true
  );
}

/**
 * Unwraps a value that may be (or, one level deep, contain) a `transfer()` result,
 * collecting every transferable along the way for `postMessage`'s transfer list.
 * Call arguments are an array, so array elements are also unwrapped; anything nested
 * deeper is sent through structured clone as-is (`transfer()` is meant to mark a
 * single value, not to be searched for recursively).
 */
export function extractTransferables(value: unknown): {
  value: unknown;
  transferables: Transferable[];
} {
  if (isTransferWrapper(value)) {
    return { value: value.value, transferables: [...value.transferables] };
  }
  if (Array.isArray(value)) {
    const transferables: Transferable[] = [];
    const values = value.map((item) => {
      if (!isTransferWrapper(item)) return item;
      transferables.push(...item.transferables);
      return item.value;
    });
    return { value: values, transferables };
  }
  return { value, transferables: [] };
}
