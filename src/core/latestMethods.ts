import { IframeKitError } from './errors';

/**
 * Wraps each function in `ref.current.methods` (as of now) so a call always runs the
 * latest one, letting hooks take new `methods` on every render without
 * re-registering. See docs/design.md → RPC and events API → Behaviour.
 *
 * The set of names is fixed here; a name whose function later disappears (or all of
 * them, once `ref.current` has no `methods`) answers with `RIK_METHOD_NOT_FOUND`.
 */
export function latestMethods(ref: {
  readonly current: { methods?: object | undefined };
}): Record<string, (...args: unknown[]) => unknown> {
  const wrappers: Record<string, (...args: unknown[]) => unknown> = {};
  const initial = (ref.current.methods ?? {}) as Record<string, unknown>;
  for (const name of Object.keys(initial)) {
    if (typeof initial[name] !== 'function') continue;
    wrappers[name] = (...args) => {
      const fn = (ref.current.methods as Record<string, unknown> | undefined)?.[name];
      if (typeof fn !== 'function') {
        throw new IframeKitError(
          'RIK_METHOD_NOT_FOUND',
          `react-iframe-kit: the method "${name}" is no longer registered.`,
        );
      }
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return wrappers;
}
