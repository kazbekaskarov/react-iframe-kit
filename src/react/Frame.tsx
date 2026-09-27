import {
  type ForwardedRef,
  type ForwardRefExoticComponent,
  forwardRef,
  type IframeHTMLAttributes,
  type MutableRefObject,
  type ReactNode,
  type RefAttributes,
  useCallback,
  useMemo,
  useRef,
} from 'react';
import { createPortal } from 'react-dom';
import { mirrorStyles } from '../core/styles';
import { type FrameContextValue, getFrameContext } from './context';
import { useIframe } from './useIframe';
import { type UseIframeResizeOptions, useIframeResize } from './useIframeResize';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export interface FrameProps
  extends Omit<IframeHTMLAttributes<HTMLIFrameElement>, 'children' | 'srcDoc'> {
  /** Rendered into the iframe's `<body>`. */
  children?: ReactNode;
  /** Rendered into the iframe's `<head>`, e.g. `<style>` or `<link>` elements. */
  head?: ReactNode;
  /**
   * Mirror the parent document's `<style>` / `<link rel="stylesheet">` into the iframe,
   * including ones added later. See docs/design.md → `<Frame>` for the limits.
   */
  copyStyles?: boolean;
  /** Custom iframe document. Must be stable across renders; see `useIframe`. */
  srcDoc?: string;
  /**
   * Size the iframe to its content: `true` for height, or `useIframeResize` options.
   * The resized axis is then owned by the library. See docs/design.md → Resize.
   */
  resize?: boolean | UseIframeResizeOptions;
}

/**
 * Renders React children into a same-origin iframe. Content is mounted only into the
 * iframe's final document, in standards mode, and remounted after every reload.
 * See docs/design.md → Portal mode.
 */
export const Frame: ForwardRefExoticComponent<FrameProps & RefAttributes<HTMLIFrameElement>> =
  /* @__PURE__ */ forwardRef(function Frame(
    { children, head, copyStyles = false, srcDoc, resize = false, ...iframeProps }: FrameProps,
    forwardedRef: ForwardedRef<HTMLIFrameElement>,
  ) {
    const frame = useIframe({ srcDoc });
    const FrameContext = getFrameContext();
    useIframeResize(resize ? frame.iframe : null, typeof resize === 'object' ? resize : {});

    const warnedStyle = useRef(false);
    if (__DEV__ && resize && !warnedStyle.current) {
      const axis = (typeof resize === 'object' && resize.axis) || 'height';
      const style = iframeProps.style;
      const owned = (['height', 'width'] as const).filter(
        (name) => (axis === 'both' || axis === name) && style?.[name] !== undefined,
      );
      if (owned.length > 0) {
        warnedStyle.current = true;
        console.warn(
          `react-iframe-kit: <Frame resize> owns the iframe's ${owned.join(' and ')}; the value in \`style\` is only used until the first measurement.`,
        );
      }
    }

    const { ref: frameRef } = frame.frameProps;
    const ref = useCallback(
      (node: HTMLIFrameElement | null) => {
        frameRef(node);
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef)
          (forwardedRef as MutableRefObject<HTMLIFrameElement | null>).current = node;
      },
      [frameRef, forwardedRef],
    );

    const target = copyStyles ? frame.document : null;
    useIsomorphicLayoutEffect(() => {
      return target ? mirrorStyles(document, target) : undefined;
    }, [target]);

    const context = useMemo<FrameContextValue>(
      () => ({ window: frame.window, document: frame.document }),
      [frame.window, frame.document],
    );

    const inFrame = (node: ReactNode, container: HTMLElement) =>
      createPortal(
        <FrameContext.Provider value={context}>{node}</FrameContext.Provider>,
        container,
      );

    return (
      <>
        <iframe {...iframeProps} srcDoc={frame.frameProps.srcDoc} ref={ref} />
        {frame.document && head !== undefined && inFrame(head, frame.document.head)}
        {frame.mountNode && inFrame(children, frame.mountNode)}
      </>
    );
  });
