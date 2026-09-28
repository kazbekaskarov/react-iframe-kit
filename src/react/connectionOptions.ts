/**
 * Options every parent hook takes for the iframe's connection, which all hooks on one
 * iframe share. See docs/design.md → Connection sharing.
 */
export interface IframeConnectionOptions {
  /**
   * Expected origin of a cross-origin iframe. Optional: derived from the iframe's `src`
   * otherwise. Hooks on the same iframe must agree. See docs/design.md → Security.
   */
  origin?: string | undefined;
  /** Required to pass `origin: '*'`. */
  unsafeAllowAnyOrigin?: boolean | undefined;
  /**
   * Log the connection's protocol traffic to the console. On for the iframe as soon as
   * any hook on it asks. See docs/design.md → Errors.
   */
  debug?: boolean | undefined;
}
