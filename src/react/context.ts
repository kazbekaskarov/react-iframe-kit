import { type Context, createContext, useContext } from 'react';
import { getRegistry } from '../core/registry';

export interface FrameContextValue {
  window: Window | null;
  document: Document | null;
}

/**
 * Created once per page and shared through the registry, so `useFrame` from one
 * library copy works inside a `<Frame>` from another. See docs/design.md → Package layout.
 */
export function getFrameContext(): Context<FrameContextValue | null> {
  const registry = getRegistry();
  registry.frameContext ??= createContext<FrameContextValue | null>(null);
  return registry.frameContext as Context<FrameContextValue | null>;
}

let globalFrame: FrameContextValue | undefined;

/**
 * The `window` and `document` that the calling component renders into: the iframe's
 * inside a `<Frame>`, the global ones outside it, `null` on the server.
 */
export function useFrame(): FrameContextValue {
  const frame = useContext(getFrameContext());
  if (frame) return frame;
  if (typeof window === 'undefined') return { window: null, document: null };
  globalFrame ??= { window, document };
  return globalFrame;
}
