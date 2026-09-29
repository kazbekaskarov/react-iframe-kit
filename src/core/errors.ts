/**
 * Error classes shared by every entry. See docs/design.md → Errors.
 *
 * Several copies of this module can be loaded on one page (duplicate library copies,
 * ESM + CJS). `instanceof` therefore checks a global brand instead of the prototype
 * chain, so it works across copies and library versions.
 */

export type ErrorCode =
  | 'RIK_TIMEOUT'
  | 'RIK_CONNECTION_LOST'
  | 'RIK_DESTROYED'
  | 'RIK_METHOD_NOT_FOUND'
  | 'RIK_REMOTE_ERROR'
  | 'RIK_DATA_CLONE'
  | 'RIK_QUEUE_OVERFLOW'
  | 'RIK_ORIGIN_CONFLICT'
  | 'RIK_METHOD_CONFLICT'
  | 'RIK_INVALID_OPTIONS'
  | 'RIK_VALIDATION';

/** Error as it crosses the wire. See docs/design.md → Port messages. */
export interface SerializedError {
  name: string;
  message: string;
  code?: string | number;
  data?: unknown;
  stack?: string;
}

export type TimeoutPhase = 'connect' | 'response';

// The key is part of the cross-copy contract and must never change.
const BRAND: unique symbol = Symbol.for('react-iframe-kit/error');

export function isIframeKitError(value: unknown): value is IframeKitError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[BRAND] === true &&
    typeof (value as { code?: unknown }).code === 'string'
  );
}

export class IframeKitError extends Error {
  /** Set on subclasses that stand for exactly one code. */
  static readonly code: ErrorCode | undefined = undefined;

  static override [Symbol.hasInstance](value: unknown): boolean {
    if (!isIframeKitError(value)) return false;
    // `this` is the class on the right of `instanceof`, so subclasses check their own code.
    // biome-ignore lint/complexity/noThisInStatic: polymorphic on purpose, see above
    return this.code === undefined || value.code === this.code;
  }

  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'IframeKitError';
    this.code = code;
    Object.defineProperty(this, BRAND, { value: true });
  }
}

export class RemoteError extends IframeKitError {
  static override readonly code: ErrorCode = 'RIK_REMOTE_ERROR';

  declare readonly cause: SerializedError;

  constructor(error: SerializedError) {
    super('RIK_REMOTE_ERROR', error.message, { cause: error });
    this.name = 'RemoteError';
  }
}

/**
 * Turns a thrown value into its wire form. See docs/design.md → Port messages.
 *
 * `stack` is included only when `includeStack` (the responding side's `debug`) is
 * true: stacks leak file paths and internals to another origin.
 */
export function serializeError(value: unknown, includeStack: boolean): SerializedError {
  if (!(value instanceof Error)) {
    return { name: 'Error', message: String(value) };
  }
  const error: SerializedError = { name: value.name, message: value.message };
  const code = (value as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') error.code = code;
  if (Object.hasOwn(value, 'data')) error.data = (value as { data?: unknown }).data;
  if (includeStack && value.stack !== undefined) error.stack = value.stack;
  return error;
}

export class TimeoutError extends IframeKitError {
  static override readonly code: ErrorCode = 'RIK_TIMEOUT';

  readonly phase: TimeoutPhase;

  constructor(phase: TimeoutPhase, message: string) {
    super('RIK_TIMEOUT', message);
    this.name = 'TimeoutError';
    this.phase = phase;
  }
}
