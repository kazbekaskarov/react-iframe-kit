/**
 * Content size of a document, shared by same-origin resize (parent) and `autoResize`
 * (child). See docs/design.md → Resize → Measurement.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Measurement extends Size {
  /** The document's viewport, i.e. the iframe's inner size. */
  viewport: Size;
  /** `scrollHeight`/`scrollWidth` was used because content overflows `<html>`. */
  overflow: boolean;
  /** `<html>` is as wide as the viewport, so `width` says nothing about the content. */
  viewportBoundWidth: boolean;
}

export type MeasureFn = (doc: Document) => Size;

/**
 * Measures `doc`, or returns `null` when it isn't rendered (an iframe that is
 * `display: none` or in a hidden tab measures as 0 × 0; reporting that would collapse
 * the iframe).
 */
export function measureDocument(doc: Document, measure?: MeasureFn): Measurement | null {
  const root = doc.documentElement;
  const rect = root.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return null;

  const viewport = { width: root.clientWidth, height: root.clientHeight };
  const view = doc.defaultView;
  if (view) {
    viewport.width = view.innerWidth;
    viewport.height = view.innerHeight;
  }

  if (measure) {
    const custom = measure(doc);
    return {
      width: Math.ceil(custom.width),
      height: Math.ceil(custom.height),
      viewport,
      overflow: false,
      viewportBoundWidth: false,
    };
  }

  // `<html>`'s box handles collapsing margins consistently. Its scroll size can't be
  // used directly: it never drops below the viewport, so the iframe could only grow.
  // It is used only when content really overflows the viewport, e.g. with an
  // `html, body { height: 100% }` reset or absolutely positioned content.
  let height = Math.ceil(rect.height);
  let width = Math.ceil(rect.width);
  let overflow = false;
  if (root.scrollHeight > root.clientHeight && root.scrollHeight > height) {
    height = root.scrollHeight;
    overflow = true;
  }
  if (root.scrollWidth > root.clientWidth && root.scrollWidth > width) {
    width = root.scrollWidth;
    overflow = true;
  }

  return { width, height, viewport, overflow, viewportBoundWidth: width === root.clientWidth };
}
