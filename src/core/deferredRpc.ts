/**
 * A stable `remote`/`emit` pair for a hook whose connection comes and goes: before
 * the iframe element exists (`idle`), between element swaps, and after a
 * configuration error. Calls and events made without a connection wait here, in
 * order, and are handed to the connection's own queue once one is attached. See
 * docs/design.md → RPC and events API → Behaviour.
 */
import { IframeKitError } from './errors';
import { type CallOptions, createRemote, type RemoteMethod, withOptions } from './remote';
import { QUEUE_LIMIT, type RpcHandle } from './rpc';

/** What `attach()` needs from a connection's RPC handle. */
type Target = Pick<RpcHandle, 'remote' | 'emit'>;

type Item =
  | { kind: 'call'; run: (handle: Target) => void; fail: (error: unknown) => void }
  | { kind: 'event'; name: string; payload: unknown };

function invoke(
  handle: Target,
  method: string,
  args: unknown[],
  options: CallOptions | undefined,
): Promise<unknown> {
  // The remote proxy returns a function for every string key.
  const fn = handle.remote[method] as RemoteMethod;
  return (options ? withOptions(fn, options) : fn)(...args);
}

export class DeferredRpc {
  readonly remote: Record<string, RemoteMethod>;
  readonly emit: (name: string, payload?: unknown) => void;

  private handle: Target | null = null;
  private error: unknown = null;
  private disposed = false;
  private queue: Item[] = [];

  constructor(private readonly getConnectTimeout: () => number) {
    this.remote = createRemote((method, args, options) => this.call(method, args, options));
    this.emit = (name, payload) => this.sendEvent(name, payload);
  }

  /** A connection is available (flushes what waited), or no longer is (`null`). */
  attach(handle: Target | null): void {
    this.handle = handle;
    if (!handle) return;
    this.error = null;
    const queued = this.queue;
    this.queue = [];
    for (const item of queued) {
      if (item.kind === 'call') item.run(handle);
      else handle.emit(item.name, item.payload);
    }
  }

  /** A configuration error: waiting and future calls reject with it until `attach()`. */
  fail(error: unknown): void {
    this.handle = null;
    this.error = error;
    this.rejectQueued(error);
  }

  /** Rejects waiting and later calls with `RIK_DESTROYED` until `reopen()`. */
  dispose(): void {
    this.disposed = true;
    this.handle = null;
    this.rejectQueued(destroyed());
  }

  /** Undoes `dispose()`: StrictMode unmounts and remounts the same hook instance. */
  reopen(): void {
    this.disposed = false;
  }

  private rejectQueued(error: unknown): void {
    const queued = this.queue;
    this.queue = [];
    for (const item of queued) if (item.kind === 'call') item.fail(error);
  }

  private call(method: string, args: unknown[], options?: CallOptions): Promise<unknown> {
    if (this.handle) return invoke(this.handle, method, args, options);
    if (this.disposed) return Promise.reject(destroyed());
    if (this.error) return Promise.reject(this.error);
    if (this.queue.length >= QUEUE_LIMIT) return Promise.reject(overflow());

    return new Promise((resolve, reject) => {
      const signal = options?.signal;
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
      };
      const item: Item = {
        kind: 'call',
        run: (handle) => {
          cleanup();
          invoke(handle, method, args, options).then(resolve, reject);
        },
        fail: (error) => {
          cleanup();
          reject(error);
        },
      };
      const dequeueAndFail = (error: unknown) => {
        this.queue.splice(this.queue.indexOf(item), 1);
        item.fail(error);
      };
      const onAbort = () => dequeueAndFail(signal?.reason);
      const connectTimeout = this.getConnectTimeout();
      const timer = Number.isFinite(connectTimeout)
        ? setTimeout(
            () =>
              dequeueAndFail(
                Object.assign(
                  new IframeKitError(
                    'RIK_TIMEOUT',
                    `react-iframe-kit: still no iframe element after ${connectTimeout} ms.`,
                  ),
                  { phase: 'connect' },
                ),
              ),
            connectTimeout,
          )
        : undefined;
      signal?.addEventListener('abort', onAbort, { once: true });
      this.queue.push(item);
    });
  }

  private sendEvent(name: string, payload: unknown): void {
    if (this.handle) {
      this.handle.emit(name, payload);
      return;
    }
    if (this.disposed || this.error) return;
    if (this.queue.length >= QUEUE_LIMIT) {
      console.error(
        'react-iframe-kit: more than 1,000 messages are already queued; dropping an event.',
      );
      return;
    }
    this.queue.push({ kind: 'event', name, payload });
  }
}

function destroyed(): IframeKitError {
  return new IframeKitError('RIK_DESTROYED', 'react-iframe-kit: the hook was unmounted.');
}

function overflow(): IframeKitError {
  return new IframeKitError(
    'RIK_QUEUE_OVERFLOW',
    'react-iframe-kit: more than 1,000 messages are already queued.',
  );
}
