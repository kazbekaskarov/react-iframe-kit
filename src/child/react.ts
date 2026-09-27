// Child React entry: `react-iframe-kit/child/react`. See docs/design.md → RPC and
// events API.

import { useRef, useState } from 'react';
import {
  type ChildStatus,
  type ConnectToParentOptions,
  connectToParent,
  onParentEvent,
  onParentStatusChange,
  type ParentHandle,
} from '../core/childConnection';
import type { AnySide, Emit, Remote, SideShape } from '../core/contract';
import { DeferredRpc } from '../core/deferredRpc';
import type { IframeKitError } from '../core/errors';
import { latestMethods } from '../core/latestMethods';
import { DEFAULT_CONNECT_TIMEOUT } from '../core/rpc';
import { useIsomorphicLayoutEffect } from '../react/useIsomorphicLayoutEffect';

export type ParentStatus = ChildStatus | 'error';

export type UseParentOptions<LocalSide extends SideShape = AnySide> =
  ConnectToParentOptions<LocalSide>;

export interface UseParentResult<RemoteSide extends SideShape, LocalSide extends SideShape> {
  /** The parent's methods. Stable across renders; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of this page's events. Stable across renders. */
  emit: Emit<LocalSide>;
  /** `'idle'` on the server, before hydration, and when the page isn't framed. */
  status: ParentStatus;
  /** The configuration error behind `status: 'error'`. */
  error: IframeKitError | null;
}

const STILL_CONNECTING_MS = 10_000;

/**
 * Connects this page to its parent, backed by the same page-level connection as
 * `connectToParent`. Options are read once, on mount, except `methods`: the latest
 * ones are always used. Generic order is `<Remote, Local>`: the parent's side first.
 */
export function useParent<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(options: UseParentOptions<LocalSide>): UseParentResult<RemoteSide, LocalSide> {
  const optionsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  const [deferred] = useState(
    () => new DeferredRpc(() => optionsRef.current.connectTimeout ?? DEFAULT_CONNECT_TIMEOUT),
  );
  const [state, setState] = useState<{ status: ParentStatus; error: IframeKitError | null }>({
    status: 'idle',
    error: null,
  });

  const retained = useRef<{ handle: ParentHandle; timer?: ReturnType<typeof setTimeout> }>(
    undefined,
  );
  // See useIframeRPC: off from unmount on, so an unmounted component's methods answer
  // RIK_METHOD_NOT_FOUND during the deferral window instead of being called.
  const active = useRef(false);
  const [methodsRef] = useState(() => ({
    get current() {
      return active.current ? optionsRef.current : {};
    },
  }));

  // A layout effect: a call from the parent can arrive between this commit and its
  // passive effects, and must find this component's methods registered. Teardown is
  // deferred by one macrotask so StrictMode's simulated unmount/remount reuses the
  // same handle instead of rejecting calls a mount effect just made. See
  // docs/design.md → Connection sharing.
  useIsomorphicLayoutEffect(() => {
    active.current = true;
    deferred.reopen();
    let entry = retained.current;
    if (entry) {
      clearTimeout(entry.timer);
    } else {
      try {
        entry = {
          handle: connectToParent<AnySide, AnySide>({
            ...optionsRef.current,
            methods: latestMethods(methodsRef),
          } as ConnectToParentOptions),
        };
      } catch (error) {
        // See useIframeRPC: surfaced as `status: 'error'` and logged, never thrown.
        console.error(error);
        deferred.fail(error);
        setState({ status: 'error', error: error as IframeKitError });
        return () => {
          active.current = false;
          deferred.dispose();
        };
      }
      retained.current = entry;
      deferred.attach(entry.handle);
    }

    let warnTimer: ReturnType<typeof setTimeout> | undefined;
    const offStatus = onParentStatusChange((status) => {
      setState((prev) => (prev.status === status ? prev : { status, error: null }));
      if (!__DEV__) return;
      clearTimeout(warnTimer);
      if (status !== 'connecting') return;
      warnTimer = setTimeout(() => {
        console.warn(
          `react-iframe-kit: still not connected to the parent page after ${STILL_CONNECTING_MS / 1000} s. Likely causes: the parent doesn't use \`useIframeRPC\`, \`useIframeEvent\` or \`useIframeResize\` on this iframe, \`allowedOrigins\` doesn't include the parent's origin, or the parent expects a different origin for this page.`,
        );
      }, STILL_CONNECTING_MS);
    });

    const kept = entry;
    return () => {
      active.current = false;
      offStatus();
      clearTimeout(warnTimer);
      kept.timer = setTimeout(() => {
        retained.current = undefined;
        deferred.dispose();
        kept.handle.dispose();
      }, 0);
    };
  }, [deferred]);

  return {
    remote: deferred.remote as Remote<RemoteSide>,
    emit: deferred.emit as Emit<LocalSide>,
    status: state.status,
    error: state.error,
  };
}

/**
 * Runs `handler` for every `name` event the parent emits; the latest handler is
 * always used. Needs a `useParent` or `connectToParent` somewhere on the page to
 * configure the connection. Pass the parent's side and the name to type the payload:
 * `useParentEvent<ParentSide, 'themeChanged'>('themeChanged', (t) => …)`.
 */
export function useParentEvent<
  RemoteSide extends SideShape = AnySide,
  Name extends keyof RemoteSide['events'] & string = keyof RemoteSide['events'] & string,
>(name: Name, handler: (payload: RemoteSide['events'][Name]) => void): void {
  const handlerRef = useRef(handler);
  useIsomorphicLayoutEffect(() => {
    handlerRef.current = handler;
  });

  useIsomorphicLayoutEffect(
    () =>
      onParentEvent(name, (payload) => handlerRef.current(payload as RemoteSide['events'][Name])),
    [name],
  );
}
