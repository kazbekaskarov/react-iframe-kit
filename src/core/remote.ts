/**
 * `remote`, the typed caller for the other side's methods, and `withOptions`, which
 * gives one call a different `signal`/`timeout`. Shared by `useIframeRPC` and
 * `connectToParent`'s handle. See docs/design.md → `remote`, Behaviour.
 */
import { IframeKitError } from './errors';

export interface CallOptions {
  signal?: AbortSignal | undefined;
  timeout?: number | undefined;
}

export type RemoteCaller = (
  method: string,
  args: unknown[],
  options?: CallOptions,
) => Promise<unknown>;

export type RemoteMethod = (...args: unknown[]) => Promise<unknown>;

// Not exported: only `withOptions` needs to read this back off a `remote.x` function.
const META: unique symbol = Symbol.for('react-iframe-kit/remote-method');

interface RemoteMethodMeta {
  method: string;
  call: RemoteCaller;
}

/**
 * A shallow `Proxy`: `remote.x` is a stable function per method name for the
 * lifetime of this object (callers create one `remote` per connection/hook, not per
 * render). `then`/`toJSON`/symbol keys resolve to `undefined` so the object is never
 * mistaken for a thenable or serialized oddly.
 */
export function createRemote(call: RemoteCaller): Record<string, RemoteMethod> {
  const cache = new Map<string, RemoteMethod>();
  return new Proxy({} as Record<string, RemoteMethod>, {
    get(_target, prop) {
      if (prop === 'then' || prop === 'toJSON' || typeof prop === 'symbol') return undefined;
      let fn = cache.get(prop);
      if (!fn) {
        const bound: RemoteMethod & { [META]?: RemoteMethodMeta } = (...args) => call(prop, args);
        bound[META] = { method: prop, call };
        fn = bound;
        cache.set(prop, fn);
      }
      return fn;
    },
  });
}

/**
 * `withOptions(remote.method, { signal, timeout })` — a per-call override of the
 * connection's default `timeout`, and/or an `AbortSignal`. Throws `RIK_INVALID_OPTIONS`
 * for a function that didn't come from a `remote` object.
 */
export function withOptions<F extends (...args: never[]) => Promise<unknown>>(
  fn: F,
  options: CallOptions,
): F {
  const meta = (fn as unknown as { [META]?: RemoteMethodMeta })[META];
  if (!meta) {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      'react-iframe-kit: `withOptions` must be called with a method from `remote`.',
    );
  }
  return ((...args: unknown[]) => meta.call(meta.method, args, options)) as unknown as F;
}
