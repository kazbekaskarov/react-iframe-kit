/**
 * The full `connectToParent`: the lite one's connection plus RPC and events. The only
 * child module that imports the RPC engine. See docs/design.md → RPC and events API,
 * Package layout (`child/lite`).
 */
import {
  type ChildStatus,
  getChildConnection,
  type LiteConnectToParentOptions,
  openParentHandle,
} from './childConnection';
import type { AnySide, Emit, LocalMethods, On, Remote, SideShape } from './contract';
import { type RpcAcquireOptions, RpcEngine, type RpcHandle } from './rpc';

export interface ConnectToParentOptions<LocalSide extends SideShape = AnySide>
  extends LiteConnectToParentOptions {
  /** Methods this page exposes to the parent. See docs/design.md → RPC and events API. */
  methods?: LocalMethods<LocalSide> | undefined;
  /** Per call, from send to result. Default 10 s; `Infinity` is allowed. */
  timeout?: number | undefined;
  connectTimeout?: number | undefined;
}

export interface ParentHandle<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
> {
  readonly status: ChildStatus;
  /** The parent's methods; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of this page's events to the parent. */
  emit: Emit<LocalSide>;
  /** Subscribes to one of the parent's events; returns the unsubscribe function. */
  on: On<RemoteSide>;
  /** Resolves on the next `'connected'`; rejects `RIK_DESTROYED` on dispose. */
  whenConnected(): Promise<void>;
  /** Releases this caller's share of the page's connection. Safe to call once. */
  dispose(): void;
}

/**
 * Connects this page to its parent frame. Returns a handle whose `status` tracks the
 * shared page-level connection; call `dispose()` when this caller no longer needs it.
 * A no-op that stays `'idle'` on the server and when the page isn't framed.
 * See docs/design.md → RPC and events API, Resize.
 */
export function connectToParent<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(options: ConnectToParentOptions<LocalSide>): ParentHandle<RemoteSide, LocalSide> {
  // Each caller is its own RPC user: its methods, handlers and calls are released
  // with it, without touching other callers on the same page connection.
  let rpc: RpcHandle | undefined;
  const base = openParentHandle(options, (connection) => {
    const acquired = connection.acquireRpc(
      {},
      {
        methods: options.methods as RpcAcquireOptions['methods'],
        timeout: options.timeout,
        connectTimeout: options.connectTimeout,
      },
      RpcEngine,
    );
    rpc = acquired;
    return () => acquired.release();
  });
  // `rpc` is set by `setup`, which either ran or threw.
  const { remote, emit, on } = rpc as unknown as RpcHandle;
  return Object.assign(base, { remote, emit, on }) as unknown as ParentHandle<
    RemoteSide,
    LocalSide
  >;
}

/**
 * @internal For `useParentEvent`: registers `handler` on the page connection without
 * configuring it (a `connectToParent`/`useParent` caller does that).
 */
export function onParentEvent(name: string, handler: (payload: unknown) => void): () => void {
  const rpc = getChildConnection().acquireRpc({}, {}, RpcEngine);
  const off = rpc.on(name, handler);
  return () => {
    off();
    rpc.release();
  };
}
