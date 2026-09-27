import { useRef } from 'react';
import type { AnySide, SideShape } from '../core/contract';
import { acquireParentConnection } from '../core/parentConnection';
import { RpcEngine } from '../core/rpc';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export interface UseIframeEventOptions {
  /** Same meaning as in `useIframeRPC`; shares its connection. */
  origin?: string | undefined;
  unsafeAllowAnyOrigin?: boolean | undefined;
}

/**
 * Runs `handler` for every `name` event the iframe emits. The latest handler is
 * always used. Events that arrive while no handler is registered are dropped. See
 * docs/design.md → RPC and events API.
 *
 * Pass the iframe's side, and the event name to type the payload exactly:
 * `useIframeEvent<ChildSide, 'submitted'>(ref, 'submitted', (p) => …)`.
 */
export function useIframeEvent<
  RemoteSide extends SideShape = AnySide,
  Name extends keyof RemoteSide['events'] & string = keyof RemoteSide['events'] & string,
>(
  target: IframeTarget,
  name: Name,
  handler: (payload: RemoteSide['events'][Name]) => void,
  options: UseIframeEventOptions = {},
): void {
  const iframe = useIframeTarget(target);

  const latest = useRef({ handler, options });
  useIsomorphicLayoutEffect(() => {
    latest.current = { handler, options };
  });

  useIsomorphicLayoutEffect(() => {
    if (!iframe) return;
    const { origin, unsafeAllowAnyOrigin } = latest.current.options;
    let connection: ReturnType<typeof acquireParentConnection>;
    try {
      connection = acquireParentConnection(iframe, { origin, unsafeAllowAnyOrigin });
    } catch (error) {
      console.error(error);
      return;
    }
    const rpc = connection.acquireRpc({}, {}, RpcEngine);
    const off = rpc.on(name, (payload) =>
      latest.current.handler(payload as RemoteSide['events'][Name]),
    );
    return () => {
      off();
      rpc.release();
      connection.release();
    };
  }, [iframe, name]);
}
