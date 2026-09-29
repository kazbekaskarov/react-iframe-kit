import { useRef, useState } from 'react';
import type { AnySide, Emit, LocalMethods, Remote, SideShape } from '../core/contract';
import { DeferredRpc } from '../core/deferredRpc';
import type { IframeKitError } from '../core/errors';
import { latestMethods } from '../core/latestMethods';
import { acquireParentConnection, type ParentConnection } from '../core/parentConnection';
import { DEFAULT_CONNECT_TIMEOUT, RpcEngine, type RpcHandle } from '../core/rpc';
import type { IframeConnectionOptions } from './connectionOptions';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

/**
 * `'timeout'` is `'connecting'` for longer than `connectTimeout`: the page to show "the
 * widget didn't load". It isn't terminal: the status moves on to `'connected'` if the
 * handshake completes later.
 */
export type RPCStatus = 'idle' | 'connecting' | 'connected' | 'timeout' | 'error';

export interface UseIframeRPCOptions<Local extends SideShape = AnySide>
  extends IframeConnectionOptions {
  /** Methods the iframe may call. The latest ones are always used. */
  methods?: LocalMethods<Local> | undefined;
  /** Per call, from send to result. Default 10 s; `Infinity` is allowed. */
  timeout?: number | undefined;
  /**
   * How long to wait for the connection: a queued call rejects with `RIK_TIMEOUT` after
   * this long, and `status` becomes `'timeout'` after this long in `'connecting'`
   * (counted from the iframe's first `load` for `loading="lazy"`). Default 30 s;
   * `Infinity` is allowed.
   */
  connectTimeout?: number | undefined;
}

export interface UseIframeRPCResult<RemoteSide extends SideShape, LocalSide extends SideShape> {
  /** The iframe's methods. Stable across renders; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of this side's events. Stable across renders. */
  emit: Emit<LocalSide>;
  status: RPCStatus;
  /** The configuration error behind `status: 'error'`. */
  error: IframeKitError | null;
}

const STILL_CONNECTING_MS = 10_000;

interface Retained {
  iframe: HTMLIFrameElement;
  connection: ParentConnection;
  handle: RpcHandle;
  releaseTimer: ReturnType<typeof setTimeout> | undefined;
}

/**
 * Typed calls and events between this page and an iframe. See docs/design.md → RPC
 * and events API. Generic order is `<Remote, Local>`: the iframe's side first.
 */
export function useIframeRPC<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(
  target: IframeTarget,
  options: UseIframeRPCOptions<LocalSide> = {},
): UseIframeRPCResult<RemoteSide, LocalSide> {
  const iframe = useIframeTarget(target);

  const optionsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  const [deferred] = useState(
    () => new DeferredRpc(() => optionsRef.current.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT),
  );
  const [state, setState] = useState<{ status: RPCStatus; error: IframeKitError | null }>({
    status: 'idle',
    error: null,
  });

  // Teardown is deferred by one macrotask, like the connection's own (see
  // docs/design.md → Connection sharing): StrictMode's simulated unmount/remount then
  // reuses the same RPC registration instead of rejecting the calls a mount effect
  // just made with RIK_DESTROYED.
  const disposeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  // Off from unmount on, synchronously: during the deferral window this component's
  // methods answer RIK_METHOD_NOT_FOUND, so an unmounted component's method is never
  // called. (StrictMode remounts synchronously, so nothing can arrive in between.)
  const active = useRef(false);
  const [methodsRef] = useState(() => ({
    get current() {
      return active.current ? optionsRef.current : {};
    },
  }));
  useIsomorphicLayoutEffect(() => {
    clearTimeout(disposeTimer.current);
    active.current = true;
    deferred.reopen();
    return () => {
      active.current = false;
      // Unmount: calls still waiting for an iframe element reject with RIK_DESTROYED.
      disposeTimer.current = setTimeout(() => deferred.dispose(), 0);
    };
  }, [deferred]);

  const retained = useRef<Retained | null>(null);

  // A layout effect, like the other hooks: port messages are macrotasks and can
  // arrive between a commit and its passive effects. See docs/design.md →
  // Connection sharing.
  useIsomorphicLayoutEffect(() => {
    const release = (entry: Retained) => {
      clearTimeout(entry.releaseTimer);
      if (retained.current === entry) retained.current = null;
      deferred.attach(null);
      entry.handle.release();
      entry.connection.release();
    };

    // A different element (or none) now: the old registration goes right away.
    const previous = retained.current;
    if (previous && previous.iframe !== iframe) release(previous);

    if (!iframe) {
      setState({ status: 'idle', error: null });
      return;
    }

    let entry = retained.current;
    if (entry) {
      clearTimeout(entry.releaseTimer);
    } else {
      const current = optionsRef.current;
      // Never thrown from a hook (see docs/design.md → Error policy): surfaced as
      // `status: 'error'` and logged in every build.
      const fail = (error: unknown) => {
        console.error(error);
        deferred.fail(error);
        setState({ status: 'error', error: error as IframeKitError });
      };
      let connection: ParentConnection;
      try {
        connection = acquireParentConnection(iframe, {
          origin: current.origin,
          unsafeAllowAnyOrigin: current.unsafeAllowAnyOrigin,
          debug: current.debug,
        });
      } catch (error) {
        fail(error);
        return;
      }
      let handle: RpcHandle;
      try {
        handle = connection.acquireRpc(
          {},
          {
            methods: latestMethods(methodsRef),
            timeout: current.timeout,
            connectTimeout: current.connectTimeout,
          },
          RpcEngine,
        );
      } catch (error) {
        connection.release();
        fail(error);
        return;
      }
      entry = { iframe, connection, handle, releaseTimer: undefined };
      retained.current = entry;
      deferred.attach(handle);
    }

    // `'timeout'` is local to this hook (each has its own `connectTimeout`); the
    // connection itself only knows connecting/connected. See docs/design.md → Behaviour.
    const { connection } = entry;
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const armDeadline = () => {
      clearTimeout(deadline);
      const ms = optionsRef.current.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT;
      if (ms === Infinity) return; // setTimeout would fire at once
      deadline = setTimeout(
        () =>
          setState((prev) =>
            prev.status === 'connecting' ? { ...prev, status: 'timeout' } : prev,
          ),
        ms,
      );
    };
    // A lazy iframe off screen hasn't started loading, so its time starts at `load`;
    // a reload or navigation while connecting gives the new page its full time too.
    const onLoad = () => {
      if (connection.status === 'connecting') armDeadline();
    };
    iframe.addEventListener('load', onLoad);

    let warnTimer: ReturnType<typeof setTimeout> | undefined;
    const offStatus = connection.onStatusChange((status) => {
      setState((prev) => (prev.status === status && !prev.error ? prev : { status, error: null }));
      clearTimeout(deadline);
      if (status === 'connecting' && iframe.loading !== 'lazy') armDeadline();
      if (!__DEV__) return;
      clearTimeout(warnTimer);
      if (status !== 'connecting') return;
      warnTimer = setTimeout(() => {
        console.warn(
          `react-iframe-kit: the iframe is still not connected after ${STILL_CONNECTING_MS / 1000} s. Likely causes: the page inside it doesn't call \`connectToParent\` (or its script hasn't loaded), its origin doesn't match the expected one (\`origin\` option, or the origin of the iframe's \`src\`), its \`allowedOrigins\` don't include this page's origin, or \`sandbox\` without \`allow-same-origin\` (then pass \`origin: 'null'\`).`,
        );
      }, STILL_CONNECTING_MS);
    });

    const kept = entry;
    return () => {
      offStatus();
      iframe.removeEventListener('load', onLoad);
      clearTimeout(deadline);
      clearTimeout(warnTimer);
      kept.releaseTimer = setTimeout(() => release(kept), 0);
    };
  }, [iframe, deferred]);

  return {
    remote: deferred.remote as Remote<RemoteSide>,
    emit: deferred.emit as Emit<LocalSide>,
    status: state.status,
    error: state.error,
  };
}
