import { type RefObject, useState } from 'react';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

/** What the iframe hooks accept. See docs/design.md → RPC and events API. */
export type IframeTarget = HTMLIFrameElement | null | RefObject<HTMLIFrameElement | null>;

/**
 * Resolves an `IframeTarget` to the element. A `RefObject` is read after every commit
 * of the calling component, so swapping the element is picked up; a ref filled by
 * another component that re-renders on its own is not (pass the element instead).
 */
export function useIframeTarget(target: IframeTarget): HTMLIFrameElement | null {
  const [element, setElement] = useState<HTMLIFrameElement | null>(null);

  useIsomorphicLayoutEffect(() => {
    const next = target && 'current' in target ? target.current : target;
    setElement((current) => (current === next ? current : next));
  });

  return element;
}
