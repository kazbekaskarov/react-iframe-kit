/**
 * The RPC/events engine shared by both connection sides. See docs/design.md → RPC
 * and events API, Behaviour, Connection sharing.
 *
 * One instance lives on the connection (shared by every acquirer on it, the same way
 * the connection itself is shared); `acquire()` gives each caller its own `remote`/
 * `emit`, backed by shared dispatch tables, with per-acquirer cleanup on `release()`.
 */
import { logProtocolMessage } from './debugLog';
import { IframeKitError, RemoteError, type SerializedError, serializeError } from './errors';
import { randomId } from './id';
import {
  type CallMessage,
  type EventMessage,
  methodNotFound,
  type ResultMessage,
  RIK,
} from './protocol';
import { type CallOptions, createRemote, type RemoteCaller, type RemoteMethod } from './remote';
import { extractTransferables } from './transfer';

export const DEFAULT_TIMEOUT = 10_000;
export const DEFAULT_CONNECT_TIMEOUT = 30_000;
export const QUEUE_LIMIT = 1_000;

type LocalMethod = (...args: unknown[]) => unknown;
type EventHandler = (payload: unknown) => void;
type Send = (
  message: CallMessage | ResultMessage | EventMessage,
  transferables: Transferable[],
) => void;

export interface RpcAcquireOptions {
  methods?: Record<string, LocalMethod> | undefined;
  timeout?: number | undefined;
  connectTimeout?: number | undefined;
}

export interface RpcHandle {
  remote: Record<string, RemoteMethod>;
  emit: (name: string, payload?: unknown) => void;
  on: (name: string, handler: (payload: unknown) => void) => () => void;
  release: () => void;
}

interface PendingCall {
  user: object;
  /** For `debug` logging: which call a result answers, and its round-trip time. */
  method: string;
  sentAt: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  removeAbortListener: (() => void) | undefined;
}

interface QueuedCall {
  kind: 'call';
  user: object;
  id: string;
  method: string;
  args: unknown[];
  timeout: number;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
  signal: AbortSignal | undefined;
  connectTimer: ReturnType<typeof setTimeout> | undefined;
  removeAbortListener: (() => void) | undefined;
}

interface QueuedEvent {
  kind: 'event';
  user: object;
  name: string;
  payload: unknown;
}

type QueueItem = QueuedCall | QueuedEvent;

function reportUnhandled(error: unknown): void {
  // `reportError` is standard (browsers and Node 18+) but not universal (e.g. some
  // non-browser test runners); console.error is the fallback.
  if (typeof reportError === 'function') reportError(error);
  else console.error(error);
}

/**
 * A timestamp for `debug` timings, which are dev-only like the summary they're
 * appended to (see `logProtocolMessage`): production doesn't read the clock at all.
 */
function now(): number {
  /* v8 ignore next: __DEV__ is compile-time and `true` in tests. */
  if (!__DEV__) return 0;
  return performance.now();
}

/** `debug` detail for a result: the method it answers and how long since `start`. */
const timing = (method: string, start: number): string =>
  `${method}, ${Math.round(now() - start)} ms`;

function timeoutError(phase: 'connect' | 'response', ms: number): IframeKitError {
  const message =
    phase === 'connect'
      ? `react-iframe-kit: still not connected after ${ms} ms.`
      : `react-iframe-kit: no response within ${ms} ms.`;
  return Object.assign(new IframeKitError('RIK_TIMEOUT', message), { phase });
}

export class RpcEngine {
  private send: Send | null = null;
  private debug = false;

  private methodOwner = new Map<string, object>();
  private methods = new Map<string, LocalMethod>();
  private eventHandlers = new Map<string, Set<{ user: object; handler: EventHandler }>>();
  private userDefaults = new Map<object, { timeout: number; connectTimeout: number }>();

  private pending = new Map<string, PendingCall>();
  private queue: QueueItem[] = [];

  /**
   * Registers `user`'s methods (throwing `RIK_METHOD_CONFLICT` for a name already
   * owned by a different user, `RIK_INVALID_OPTIONS` for `then`/`toJSON`) and
   * returns its `remote`/`emit`/`on`/`release`.
   */
  acquire(user: object, options: RpcAcquireOptions): RpcHandle {
    const methods = options.methods ?? {};
    for (const name of Object.keys(methods)) {
      if (name === 'then' || name === 'toJSON') {
        throw new IframeKitError(
          'RIK_INVALID_OPTIONS',
          `react-iframe-kit: a method can't be named "${name}" — \`remote\` hides that name so it's never reachable.`,
        );
      }
      const owner = this.methodOwner.get(name);
      if (owner !== undefined && owner !== user) {
        throw new IframeKitError(
          'RIK_METHOD_CONFLICT',
          `react-iframe-kit: two users registered the method "${name}".`,
        );
      }
    }
    for (const [name, fn] of Object.entries(methods)) {
      if (typeof fn !== 'function') continue;
      this.methodOwner.set(name, user);
      this.methods.set(name, fn);
    }

    this.userDefaults.set(user, {
      timeout: options.timeout ?? DEFAULT_TIMEOUT,
      connectTimeout: options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT,
    });

    const call: RemoteCaller = (method, args, callOptions) =>
      this.call(user, method, args, callOptions);
    const remote = createRemote(call);
    const emit = (name: string, payload?: unknown) => this.emit(user, name, payload);
    const on = (name: string, handler: EventHandler) => this.onEvent(user, name, handler);
    const release = () => this.release(user);
    return { remote, emit, on, release };
  }

  /** Merges into the connection's debug flag; there is no per-user unset. */
  setDebug(enabled: boolean): void {
    if (enabled) this.debug = true;
  }

  onEvent(user: object, name: string, handler: EventHandler): () => void {
    let handlers = this.eventHandlers.get(name);
    if (!handlers) {
      handlers = new Set();
      this.eventHandlers.set(name, handlers);
    }
    const entry = { user, handler };
    handlers.add(entry);
    return () => handlers.delete(entry);
  }

  /** The connection reached (or re-reached) `'connected'`: flushes the queue. */
  connected(send: Send): void {
    this.send = send;
    const queued = this.queue;
    this.queue = [];
    for (const item of queued) {
      if (item.kind === 'call') this.sendQueuedCall(item);
      else this.sendEvent(item.name, item.payload);
    }
  }

  /** The connection dropped: pending (already-sent) calls are no longer answerable. */
  disconnected(): void {
    this.send = null;
    this.rejectPending(
      () => true,
      () => new IframeKitError('RIK_CONNECTION_LOST', 'react-iframe-kit: the connection was lost.'),
    );
  }

  /** `user` is releasing its share of the connection: see docs/design.md → Connection sharing. */
  release(user: object): void {
    for (const [name, owner] of this.methodOwner) {
      if (owner === user) {
        this.methodOwner.delete(name);
        this.methods.delete(name);
      }
    }
    for (const handlers of this.eventHandlers.values()) {
      for (const entry of handlers) if (entry.user === user) handlers.delete(entry);
    }
    this.userDefaults.delete(user);

    const destroyed = () =>
      new IframeKitError('RIK_DESTROYED', 'react-iframe-kit: the connection was released.');
    this.rejectPending((candidate) => candidate === user, destroyed);
    this.queue = this.queue.filter((item) => {
      if (item.user !== user) return true;
      if (item.kind === 'call') {
        clearTimeout(item.connectTimer);
        item.removeAbortListener?.();
        item.reject(destroyed());
      }
      return false;
    });
  }

  private rejectPending(matches: (user: object) => boolean, makeError: () => unknown): void {
    for (const [id, entry] of this.pending) {
      if (!matches(entry.user)) continue;
      clearTimeout(entry.timer);
      entry.removeAbortListener?.();
      entry.reject(makeError());
      this.pending.delete(id);
    }
  }

  handleCall(message: CallMessage): void {
    logProtocolMessage(this.debug, '←', message);
    void this.runLocalMethod(message, now());
  }

  private async runLocalMethod(message: CallMessage, start: number): Promise<void> {
    const fn = this.methods.get(message.method);
    if (!fn) {
      this.sendResult(message, start, { ok: false, error: methodNotFound(message.method) });
      return;
    }
    try {
      const value = await fn.apply(undefined, message.args);
      this.sendResult(message, start, { ok: true, value });
    } catch (error) {
      this.sendResult(message, start, { ok: false, error: serializeError(error, this.debug) });
    }
  }

  private sendResult(
    call: CallMessage,
    start: number,
    outcome: { ok: true; value: unknown } | { ok: false; error: SerializedError },
  ): void {
    if (!this.send) return; // the connection dropped while the method was running
    const { id } = call;
    const detail = __DEV__ && this.debug ? timing(call.method, start) : undefined;
    if (outcome.ok) {
      const { value, transferables } = extractTransferables(outcome.value);
      try {
        this.sendRaw({ rik: RIK, type: 'result', id, ok: true, value }, transferables, detail);
        return;
      } catch {
        // Falls through: the return value itself couldn't be cloned.
      }
      this.sendRaw(
        {
          rik: RIK,
          type: 'result',
          id,
          ok: false,
          error: {
            name: 'IframeKitError',
            message: 'the return value could not be cloned',
            code: 'RIK_DATA_CLONE',
          },
        },
        [],
        detail,
      );
      return;
    }
    try {
      this.sendRaw({ rik: RIK, type: 'result', id, ok: false, error: outcome.error }, [], detail);
    } catch {
      // The error's own `data` was the part that couldn't be cloned; drop it and retry
      // with just name/message/code, which are always plain strings/numbers.
      const minimal: SerializedError = { name: outcome.error.name, message: outcome.error.message };
      if (outcome.error.code !== undefined) minimal.code = outcome.error.code;
      this.sendRaw({ rik: RIK, type: 'result', id, ok: false, error: minimal }, [], detail);
    }
  }

  handleResult(message: ResultMessage): void {
    const entry = this.pending.get(message.id);
    logProtocolMessage(
      this.debug,
      '←',
      message,
      __DEV__ && entry && this.debug ? timing(entry.method, entry.sentAt) : undefined,
    );
    if (!entry) return; // unknown id: a stale/duplicate result, or already settled locally (e.g. abort)
    this.pending.delete(message.id);
    clearTimeout(entry.timer);
    entry.removeAbortListener?.();
    if (message.ok) entry.resolve(message.value);
    else entry.reject(new RemoteError(message.error));
  }

  handleEvent(message: EventMessage): void {
    logProtocolMessage(this.debug, '←', message);
    const handlers = this.eventHandlers.get(message.name);
    if (!handlers) return;
    for (const { handler } of handlers) {
      try {
        handler(message.payload);
      } catch (error) {
        reportUnhandled(error);
      }
    }
  }

  private call(
    user: object,
    method: string,
    args: unknown[],
    callOptions?: CallOptions,
  ): Promise<unknown> {
    const defaults = this.userDefaults.get(user);
    const timeout = callOptions?.timeout ?? defaults?.timeout ?? DEFAULT_TIMEOUT;
    const connectTimeout = defaults?.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
    const id = randomId();

    return new Promise((resolve, reject) => {
      if (callOptions?.signal?.aborted) {
        reject(callOptions.signal.reason);
        return;
      }

      if (this.send) {
        this.sendCall(user, id, method, args, timeout, resolve, reject, callOptions?.signal);
        return;
      }

      if (this.queue.length >= QUEUE_LIMIT) {
        reject(
          new IframeKitError(
            'RIK_QUEUE_OVERFLOW',
            'react-iframe-kit: more than 1,000 messages are already queued.',
          ),
        );
        return;
      }

      const item: QueuedCall = {
        kind: 'call',
        user,
        id,
        method,
        args,
        timeout,
        resolve,
        reject,
        signal: callOptions?.signal,
        connectTimer: undefined,
        removeAbortListener: undefined,
      };
      if (Number.isFinite(connectTimeout)) {
        item.connectTimer = setTimeout(() => {
          this.dequeue(item);
          item.reject(timeoutError('connect', connectTimeout));
        }, connectTimeout);
      }
      if (callOptions?.signal) {
        const signal = callOptions.signal;
        const onAbort = () => {
          this.dequeue(item);
          clearTimeout(item.connectTimer);
          item.reject(signal.reason);
        };
        signal.addEventListener('abort', onAbort, { once: true });
        item.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
      }
      this.queue.push(item);
    });
  }

  private dequeue(item: QueueItem): void {
    const index = this.queue.indexOf(item);
    if (index !== -1) this.queue.splice(index, 1);
  }

  private sendQueuedCall(item: QueuedCall): void {
    clearTimeout(item.connectTimer);
    item.removeAbortListener?.();
    this.sendCall(
      item.user,
      item.id,
      item.method,
      item.args,
      item.timeout,
      item.resolve,
      item.reject,
      item.signal,
    );
  }

  private sendCall(
    user: object,
    id: string,
    method: string,
    args: unknown[],
    timeout: number,
    resolve: (value: unknown) => void,
    reject: (error: unknown) => void,
    signal?: AbortSignal | undefined,
  ): void {
    const { value: clonableArgs, transferables } = extractTransferables(args);
    const entry: PendingCall = {
      user,
      method,
      sentAt: now(),
      resolve,
      reject,
      timer: undefined,
      removeAbortListener: undefined,
    };

    if (Number.isFinite(timeout)) {
      entry.timer = setTimeout(() => {
        this.pending.delete(id);
        entry.removeAbortListener?.();
        reject(timeoutError('response', timeout));
      }, timeout);
    }
    if (signal) {
      const onAbort = () => {
        this.pending.delete(id);
        clearTimeout(entry.timer);
        reject(signal.reason);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      entry.removeAbortListener = () => signal.removeEventListener('abort', onAbort);
    }
    this.pending.set(id, entry);

    try {
      this.sendRaw(
        { rik: RIK, type: 'call', id, method, args: clonableArgs as unknown[] },
        transferables,
      );
    } catch {
      this.pending.delete(id);
      clearTimeout(entry.timer);
      entry.removeAbortListener?.();
      reject(
        new IframeKitError(
          'RIK_DATA_CLONE',
          'react-iframe-kit: the call arguments could not be cloned.',
        ),
      );
    }
  }

  private emit(user: object, name: string, payload?: unknown): void {
    if (this.send) {
      this.sendEvent(name, payload);
      return;
    }
    if (this.queue.length >= QUEUE_LIMIT) {
      console.error(
        'react-iframe-kit: more than 1,000 messages are already queued; dropping an event.',
      );
      return;
    }
    this.queue.push({ kind: 'event', user, name, payload });
  }

  private sendEvent(name: string, payload: unknown): void {
    const { value, transferables } = extractTransferables(payload);
    try {
      this.sendRaw({ rik: RIK, type: 'event', name, payload: value }, transferables);
    } catch {
      console.error(`react-iframe-kit: the payload for event "${name}" could not be cloned.`);
    }
  }

  private sendRaw(
    message: CallMessage | ResultMessage | EventMessage,
    transferables: Transferable[] = [],
    detail?: string,
  ): void {
    /* v8 ignore start: every call site already checks `this.send` (directly, or via
     * `connected()` having just set it) before reaching here; this guard only exists
     * so TypeScript can narrow `this.send` from `Send | null` to `Send`. */
    if (!this.send) return;
    /* v8 ignore stop */
    logProtocolMessage(this.debug, '→', message, detail);
    this.send(message, transferables);
  }
}
