import { useEffect, useRef, useState } from 'react';
import { applySize, clamp, type SizeLimits } from '../core/applySize';
import { createLoopGuard } from '../core/loopGuard';
import type { MeasureFn, Measurement, Size } from '../core/measure';
import { observeSize } from '../core/observeSize';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export type ResizeAxis = 'height' | 'width' | 'both';

export interface UseIframeResizeOptions extends SizeLimits {
  /** Which dimensions follow the content. Default `'height'`. */
  axis?: ResizeAxis | undefined;
  /** `false`: only report sizes, don't touch the iframe's styles. Default `true`. */
  apply?: boolean | undefined;
  /** Called with every new content size. */
  onResize?: ((size: Size) => void) | undefined;
  /**
   * Called when the feedback-loop guard holds growth: the content sizes itself from
   * the viewport (e.g. `height: 100vh` plus a margin) and would grow forever.
   */
  onResizeLoop?: ((axis: 'width' | 'height') => void) | undefined;
  /** Replaces the built-in measurement for unusual layouts. */
  measure?: MeasureFn | undefined;
}

/**
 * Sizes an iframe to its content. v1 of this hook handles same-origin iframes, whose
 * document the parent can measure directly; cross-origin iframes are sized by the
 * child's `autoResize` (roadmap step 5). See docs/design.md → Resize.
 *
 * @returns the latest content size, or `null` before the first measurement.
 */
export function useIframeResize(
  target: IframeTarget,
  options: UseIframeResizeOptions = {},
): Size | null {
  const iframe = useIframeTarget(target);
  const [size, setSize] = useState<Size | null>(null);

  // Latest options without re-subscribing on every render.
  const optionsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  // Dev warnings already shown by this hook instance.
  const warned = useRef(new Set<string>());

  const [doc, setDoc] = useState<Document | null>(null);

  // Mode detection happens after each native `load`, never earlier: before the first
  // load every iframe holds an initial about:blank that is readable even when `src` is
  // cross-origin. See docs/design.md → Two modes.
  useIsomorphicLayoutEffect(() => {
    if (!iframe) {
      setDoc(null);
      return;
    }
    // The same-origin document to measure, or null (cross-origin, or the transient
    // initial about:blank of an iframe that is navigating to its `src`/`srcdoc`).
    const readDocument = (): Document | null => {
      let doc: Document | null;
      try {
        doc = iframe.contentDocument;
      } catch {
        return null;
      }
      if (doc?.readyState !== 'complete') return null;
      const src = iframe.getAttribute('src');
      const navigating =
        iframe.hasAttribute('srcdoc') || (src !== null && src !== '' && src !== 'about:blank');
      return navigating && doc.URL === 'about:blank' ? null : doc;
    };
    const onLoad = () => setDoc(readDocument());

    // The document may have loaded before we got here (e.g. before hydration).
    onLoad();

    iframe.addEventListener('load', onLoad);
    return () => iframe.removeEventListener('load', onLoad);
  }, [iframe]);

  useEffect(() => {
    if (!iframe || !doc) return;
    const guards = { width: createLoopGuard(), height: createLoopGuard() };
    const warnOnce = (key: string, message: string) => {
      if (warned.current.has(key)) return;
      warned.current.add(key);
      console.warn(`react-iframe-kit: ${message}`);
    };

    const onMeasurement = (measurement: Measurement) => {
      const { axis = 'height', apply = true, onResize, onResizeLoop, measure } = optionsRef.current;
      const axes = {
        width: axis === 'width' || axis === 'both',
        height: axis === 'height' || axis === 'both',
      };

      if (__DEV__ && !measure) {
        if (measurement.overflow) {
          warnOnce(
            'overflow',
            'the iframe content overflows <html> (an `html, body { height: 100% }` reset or absolutely positioned content?), so the iframe can grow but not shrink below its current size.',
          );
        }
        if (axes.width && measurement.viewportBoundWidth) {
          warnOnce(
            'width',
            "`axis` includes width, but the iframe's <html> is as wide as the iframe, so its width can't follow the content. Add `html { width: max-content }` to the iframe document.",
          );
        }
      }

      const next = { width: measurement.width, height: measurement.height };
      setSize((prev) =>
        prev && prev.width === next.width && prev.height === next.height ? prev : next,
      );
      onResize?.(next);

      const hold = (dimension: 'width' | 'height') => {
        const wasTripped = guards[dimension].tripped;
        const held = guards[dimension].check(
          measurement[dimension],
          measurement.viewport[dimension],
        );
        if (held && !wasTripped) {
          if (__DEV__) {
            console.warn(
              `react-iframe-kit: the iframe content keeps growing with the iframe's ${dimension} (content sized from the viewport, e.g. \`100vh\` or \`100%\` plus a margin or padding?). Resizing is paused until the content changes.`,
            );
          }
          onResizeLoop?.(dimension);
        }
        return held;
      };

      if (!apply) return;
      const { minWidth, maxWidth, minHeight, maxHeight } = optionsRef.current;
      const width =
        axes.width && !hold('width') ? clamp(measurement.width, minWidth, maxWidth) : undefined;
      const height =
        axes.height && !hold('height')
          ? clamp(measurement.height, minHeight, maxHeight)
          : undefined;
      applySize(iframe, width, height);
    };

    return observeSize(doc, onMeasurement, optionsRef.current.measure);
  }, [iframe, doc]);

  return size;
}
