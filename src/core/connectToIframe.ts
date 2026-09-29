/**
 * The parent side without React: `connectToIframe` from `react-iframe-kit/host`, for
 * host pages that aren't React apps (a widget's loader script on customers' sites, a
 * migration from iframe-resizer). The same connection the parent hooks share, so both
 * can be used on one iframe. See docs/design.md → Host without React.
 */
import { applySize, axesOf, clamp, type ResizeAxis, type SizeLimits } from './applySize';
import { watchConnectDeadline } from './connectDeadline';
import type { AnySide, Emit, LocalMethods, On, Remote, SideShape } from './contract';
import { IframeKitError } from './errors';
import type { Size } from './measure';
import { acquireParentConnection } from './parentConnection';
import { DEFAULT_CONNECT_TIMEOUT, type RpcAcquireOptions, RpcEngine } from './rpc';

/** `'timeout'`: still connecting after `connectTimeout`; it moves on if that changes. */
export type IframeStatus = 'connecting' | 'connected' | 'timeout';

export interface IframeResizeOptions extends SizeLimits {
  /** Which dimensions follow the content. Default `'height'`. */
  axis?: ResizeAxis | undefined;
}

export interface ConnectToIframeOptions<LocalSide extends SideShape = AnySide> {
  /**
   * Expected origin of the page inside. Optional: derived from the iframe's `src`
   * otherwise. See docs/design.md → Security.
   */
  origin?: string | undefined;
  /** Required to pass `origin: '*'`. */
  unsafeAllowAnyOrigin?: boolean | undefined;
  /** Log the connection's protocol traffic to the console. */
  debug?: boolean | undefined;
  /** Methods the page inside may call. */
  methods?: LocalMethods<LocalSide> | undefined;
  /** Per call, from send to result. Default 10 s; `Infinity` is allowed. */
  timeout?: number | undefined;
  /**
   * How long to wait for the connection: a queued call rejects with `RIK_TIMEOUT`, and
   * `status` becomes `'timeout'`, after this long. Default 30 s; `Infinity` is allowed.
   */
  connectTimeout?: number | undefined;
  /**
   * Size the iframe to the content the page inside reports (it runs
   * `connectToParent({ autoResize: true })`). `true` resizes the height.
   */
  resize?: boolean | IframeResizeOptions | undefined;
  /**
   * Set the iframe's `title` attribute to the page's own title, which it sends with
   * `connectToParent({ syncTitle: true })`. The original `title` comes back when the
   * page stops sending one, and on `dispose()`.
   */
  syncTitle?: boolean | undefined;
  /** Called on every status change. */
  onStatusChange?: ((status: IframeStatus) => void) | undefined;
  /** Called with every content size the page reports, whether or not `resize` is on. */
  onResize?: ((size: Size) => void) | undefined;
  /** Called when the page's feedback-loop guard starts holding growth. */
  onResizeLoop?: (() => void) | undefined;
}

export interface IframeHandle<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
> {
  readonly status: IframeStatus;
  /** The last content size the page reported, or `null`. */
  readonly size: Size | null;
  /** The page's title (with `syncTitle` on its side), or `null`. */
  readonly title: string | null;
  /** The page's methods; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of this side's events to the page. */
  emit: Emit<LocalSide>;
  /** Subscribes to one of the page's events; returns the unsubscribe function. */
  on: On<RemoteSide>;
  /**
   * Makes everything inside the iframe unclickable, unfocusable and untypeable, or
   * undoes it. See docs/design.md → Inert.
   */
  setInert(inert: boolean): void;
  /** Resolves on the next `'connected'`; rejects `RIK_DESTROYED` on dispose. */
  whenConnected(): Promise<void>;
  /** Releases this caller's share of the connection. Safe to call more than once. */
  dispose(): void;
}

/**
 * Connects to the page inside `iframe`, which runs `connectToParent`. Throws
 * `RIK_INVALID_OPTIONS`, `RIK_ORIGIN_CONFLICT` or `RIK_METHOD_CONFLICT` for invalid
 * options, like the child's `connectToParent`. See docs/design.md → Host without React.
 */
export function connectToIframe<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(
  iframe: HTMLIFrameElement,
  options: ConnectToIframeOptions<LocalSide> = {},
): IframeHandle<RemoteSide, LocalSide> {
  const connection = acquireParentConnection(iframe, options);
  let rpc: ReturnType<typeof connection.acquireRpc>;
  try {
    rpc = connection.acquireRpc(
      {},
      {
        methods: options.methods as RpcAcquireOptions['methods'],
        timeout: options.timeout,
        connectTimeout: options.connectTimeout,
      },
      RpcEngine,
    );
  } catch (error) {
    connection.release();
    throw error;
  }

  let status: IframeStatus = connection.status;
  let size: Size | null = null;
  let title: string | null = null;
  const waiters = new Set<{ resolve: () => void; reject: (error: unknown) => void }>();
  const setStatus = (next: IframeStatus) => {
    if (next === status) return;
    status = next;
    if (next === 'connected') {
      for (const waiter of waiters) waiter.resolve();
      waiters.clear();
    }
    options.onStatusChange?.(next);
  };

  const offStatus = connection.onStatusChange(setStatus);
  const stopDeadline = watchConnectDeadline(
    iframe,
    connection,
    () => options.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT,
    // Only ever fires while connecting: any status change clears the deadline.
    () => setStatus('timeout'),
  );

  const resize = options.resize === true ? {} : options.resize || undefined;
  let loop = false;
  const offSize = connection.onSize((reported) => {
    size = { width: reported.width, height: reported.height };
    if (resize) {
      const axes = axesOf(resize.axis ?? 'height');
      applySize(
        iframe,
        axes.width ? clamp(size.width, resize.minWidth, resize.maxWidth) : undefined,
        axes.height ? clamp(size.height, resize.minHeight, resize.maxHeight) : undefined,
      );
    }
    options.onResize?.(size);
    if (reported.loop && !loop) options.onResizeLoop?.();
    loop = reported.loop;
  });

  const originalTitle = iframe.getAttribute('title');
  const restoreTitle = () => {
    if (originalTitle === null) iframe.removeAttribute('title');
    else iframe.setAttribute('title', originalTitle);
  };
  const offTitle = connection.onTitle((next) => {
    title = next || null;
    if (!options.syncTitle) return;
    if (title) iframe.setAttribute('title', title);
    else restoreTitle();
  });

  const inertUser = {};
  let inertAttributeSetHere = false;

  let disposed = false;
  const handle = {
    get status() {
      return status;
    },
    get size() {
      return size;
    },
    get title() {
      return title;
    },
    remote: rpc.remote,
    emit: rpc.emit,
    on: rpc.on,
    setInert(inert: boolean) {
      if (disposed) return;
      if (inert && !iframe.hasAttribute('inert')) {
        iframe.setAttribute('inert', '');
        inertAttributeSetHere = true;
      } else if (!inert && inertAttributeSetHere) {
        iframe.removeAttribute('inert');
        inertAttributeSetHere = false;
      }
      connection.setInert(inertUser, inert);
    },
    whenConnected() {
      if (disposed) return Promise.reject(destroyed());
      if (status === 'connected') return Promise.resolve();
      return new Promise<void>((resolve, reject) => waiters.add({ resolve, reject }));
    },
    dispose() {
      if (disposed) return;
      handle.setInert(false);
      disposed = true;
      for (const waiter of waiters) waiter.reject(destroyed());
      waiters.clear();
      offStatus();
      stopDeadline();
      offSize();
      offTitle();
      if (options.syncTitle) restoreTitle();
      rpc.release();
      connection.release();
    },
  };
  return handle as unknown as IframeHandle<RemoteSide, LocalSide>;
}

const destroyed = () =>
  new IframeKitError('RIK_DESTROYED', 'react-iframe-kit: the iframe handle was disposed.');
