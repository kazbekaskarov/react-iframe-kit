import { useRef, useState } from 'react';
import { acquireParentConnection } from '../core/parentConnection';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export interface UseIframeTitleOptions {
  /** Same meaning as in `useIframeRPC`; shares its connection. */
  origin?: string | undefined;
  unsafeAllowAnyOrigin?: boolean | undefined;
}

/**
 * The `document.title` of the page inside the iframe, which it sends by running
 * `connectToParent({ syncTitle: true })`. `undefined` until it arrives, when it's
 * empty, and after the page unloads. See docs/design.md → Title.
 *
 * Pass it on as the iframe's accessible name, with a fallback:
 * `<iframe ref={ref} title={title ?? 'Checkout'} />`.
 */
export function useIframeTitle(
  target: IframeTarget,
  options: UseIframeTitleOptions = {},
): string | undefined {
  const iframe = useIframeTarget(target);
  // Keyed by iframe, so a new element never shows the previous one's title.
  const [state, setState] = useState<{ iframe: HTMLIFrameElement; title: string }>();

  const optionsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  useIsomorphicLayoutEffect(() => {
    if (!iframe) return;
    const { origin, unsafeAllowAnyOrigin } = optionsRef.current;
    let connection: ReturnType<typeof acquireParentConnection>;
    try {
      connection = acquireParentConnection(iframe, { origin, unsafeAllowAnyOrigin });
    } catch (error) {
      console.error(error);
      return;
    }
    const off = connection.onTitle((title) => setState(title ? { iframe, title } : undefined));
    return () => {
      off();
      connection.release();
    };
  }, [iframe]);

  return state?.iframe === iframe ? state.title : undefined;
}
