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

  // No state update at all when nothing changed. This effect runs after every commit,
  // and React 18 doesn't always bail out of a same-value update scheduled from a layout
  // effect: with several of these hooks in one component, each commit scheduled
  // another, until "Maximum update depth exceeded" (found by the React 18 e2e job).
  useIsomorphicLayoutEffect(() => {
    const next = target && 'current' in target ? target.current : target;
    if (next !== element) setElement(next);
  });

  return element;
}
