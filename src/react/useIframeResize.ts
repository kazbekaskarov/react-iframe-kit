import { useRef, useState } from 'react';
import { applySize, clamp, type SizeLimits } from '../core/applySize';
import { createLoopGuard, type LoopGuard } from '../core/loopGuard';
import type { MeasureFn, Measurement, Size } from '../core/measure';
import { observeSize } from '../core/observeSize';
import { acquireParentConnection } from '../core/parentConnection';
import type { IframeConnectionOptions } from './connectionOptions';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export type ResizeAxis = 'height' | 'width' | 'both';

export interface UseIframeResizeOptions extends SizeLimits, IframeConnectionOptions {
  /** Which dimensions follow the content. Default `'height'`. */
  axis?: ResizeAxis | undefined;
  /** `false`: only report sizes, don't touch the iframe's styles. Default `true`. */
  apply?: boolean | undefined;
  /** Called with every new content size. */
  onResize?: ((size: Size) => void) | undefined;
  /**
   * Called when the feedback-loop guard starts holding growth: the content sizes
   * itself from the viewport (e.g. `height: 100vh` plus a margin) and would grow
   * forever otherwise.
   */
  onResizeLoop?: (() => void) | undefined;
  /** Replaces the built-in measurement for unusual layouts. Same-origin mode only. */
  measure?: MeasureFn | undefined;
}

const axesOf = (axis: ResizeAxis) => ({
  width: axis === 'width' || axis === 'both',
  height: axis === 'height' || axis === 'both',
});

/** Sets the iframe's size from a content size, per the current `apply`/`axis`/limits. */
function applyContentSize(iframe: HTMLIFrameElement, size: Size, options: UseIframeResizeOptions) {
  const { apply = true, axis = 'height', minWidth, maxWidth, minHeight, maxHeight } = options;
  if (!apply) return;
  const axes = axesOf(axis);
  applySize(
    iframe,
    axes.width ? clamp(size.width, minWidth, maxWidth) : undefined,
    axes.height ? clamp(size.height, minHeight, maxHeight) : undefined,
  );
}

/**
 * Sizes an iframe to its content, same-origin or cross-origin. See docs/design.md →
 * Resize.
 *
 * Same-origin: measures the iframe's document directly. Cross-origin: relies on the
 * child running `connectToParent({ autoResize: true })`. If a same-origin child also
 * opts into `autoResize`, its reports take over from direct measurement (it knows its
 * own layout).
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

  // The last content size committed for the current iframe, so that changing the
  // limits, `axis` or `apply` takes effect without waiting for the content to change.
  const lastSize = useRef<Size | null>(null);
  const { apply, axis, minWidth, maxWidth, minHeight, maxHeight } = options;
  useIsomorphicLayoutEffect(() => {
    if (iframe && lastSize.current) applyContentSize(iframe, lastSize.current, optionsRef.current);
  }, [iframe, apply, axis, minWidth, maxWidth, minHeight, maxHeight]);

  // Hooks acquire the connection in a layout effect, not a passive one: port messages
  // are macrotasks and can arrive between a commit and its passive effects.
  // See docs/design.md → Connection sharing.
  useIsomorphicLayoutEffect(() => {
    if (!iframe) return;

    let connection: ReturnType<typeof acquireParentConnection>;
    try {
      connection = acquireParentConnection(iframe, {
        origin: optionsRef.current.origin,
        unsafeAllowAnyOrigin: optionsRef.current.unsafeAllowAnyOrigin,
        debug: optionsRef.current.debug,
      });
    } catch (error) {
      console.error(error);
      return;
    }

    const warnOnce = (key: string, message: string) => {
      if (warned.current.has(key)) return;
      warned.current.add(key);
      console.warn(`react-iframe-kit: ${message}`);
    };

    let localGuards: { width: LoopGuard; height: LoopGuard } = {
      width: createLoopGuard(),
      height: createLoopGuard(),
    };
    let lastLocalSize: Size | undefined;
    let stopLocalObserver: (() => void) | undefined;
    let currentDoc: Document | null = null;
    /** The document for which a same-origin child's own report is taking over. */
    let childReportingForDoc: Document | null = null;

    let everReceivedRemoteSize = false;
    let remoteLoop = false;
    let noSizeTimer: ReturnType<typeof setTimeout> | undefined;

    const commit = (width: number, height: number, loopStarted: boolean) => {
      const { onResize, onResizeLoop } = optionsRef.current;
      lastSize.current = { width, height };
      setSize((prev) =>
        prev && prev.width === width && prev.height === height ? prev : { width, height },
      );
      onResize?.({ width, height });
      if (loopStarted) onResizeLoop?.();
      applyContentSize(iframe, { width, height }, optionsRef.current);
    };

    const onLocalMeasurement = (measurement: Measurement) => {
      if (currentDoc && childReportingForDoc === currentDoc) return;
      const axis = optionsRef.current.axis ?? 'height';
      const axes = axesOf(axis);

      if (!optionsRef.current.measure) {
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

      const wasTripped = localGuards.width.tripped || localGuards.height.tripped;
      let width = measurement.width;
      if (axes.width && localGuards.width.check(measurement.width, measurement.viewport.width)) {
        width = lastLocalSize?.width ?? measurement.width;
      }
      let height = measurement.height;
      if (
        axes.height &&
        localGuards.height.check(measurement.height, measurement.viewport.height)
      ) {
        height = lastLocalSize?.height ?? measurement.height;
      }
      const tripped = localGuards.width.tripped || localGuards.height.tripped;
      if (tripped && !wasTripped) {
        warnOnce(
          'loop',
          'the iframe content keeps growing with the iframe (content sized from the viewport, e.g. `100vh` or `100%` plus a margin or padding?). Resizing is paused until the content changes.',
        );
      }

      lastLocalSize = { width, height };
      commit(width, height, tripped && !wasTripped);
    };

    const startLocalObserver = () => {
      stopLocalObserver?.();
      localGuards = { width: createLoopGuard(), height: createLoopGuard() };
      lastLocalSize = undefined;
      stopLocalObserver = currentDoc
        ? observeSize(currentDoc, onLocalMeasurement, optionsRef.current.measure)
        : undefined;
    };

    // Mode detection happens after each native `load`, never earlier: before the
    // first load every iframe holds an initial about:blank that is readable even
    // when `src` is cross-origin. See docs/design.md → Two modes.
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

    const onLoad = () => {
      const next = readDocument();
      if (next === currentDoc) return;
      currentDoc = next;
      if (childReportingForDoc !== currentDoc) startLocalObserver();
      else {
        stopLocalObserver?.();
        stopLocalObserver = undefined;
      }
    };
    onLoad();
    iframe.addEventListener('load', onLoad);

    const onRemoteSize = (remote: { width: number; height: number; loop: boolean }) => {
      everReceivedRemoteSize = true;
      if (noSizeTimer !== undefined) {
        clearTimeout(noSizeTimer);
        noSizeTimer = undefined;
      }
      if (currentDoc && childReportingForDoc !== currentDoc) {
        // A same-origin child also runs autoResize: its reports win, since it knows
        // its own layout. See docs/design.md → Resize → Applying.
        childReportingForDoc = currentDoc;
        stopLocalObserver?.();
        stopLocalObserver = undefined;
      }
      const loopStarted = remote.loop && !remoteLoop;
      remoteLoop = remote.loop;
      commit(remote.width, remote.height, loopStarted);
    };
    const unsubscribeSize = connection.onSize(onRemoteSize);

    noSizeTimer = setTimeout(() => {
      noSizeTimer = undefined;
      if (!everReceivedRemoteSize && currentDoc === null) {
        warnOnce(
          'no-size',
          "no size has arrived from the iframe. If it's cross-origin, enable `autoResize` in `connectToParent` inside it.",
        );
      }
    }, 5_000);

    return () => {
      iframe.removeEventListener('load', onLoad);
      stopLocalObserver?.();
      unsubscribeSize();
      if (noSizeTimer !== undefined) clearTimeout(noSizeTimer);
      connection.release();
      lastSize.current = null;
    };
  }, [iframe]);

  return size;
}
