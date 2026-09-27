/**
 * Applies a content size to an iframe element. See docs/design.md → Resize → Applying.
 */

export interface SizeLimits {
  minWidth?: number | undefined;
  maxWidth?: number | undefined;
  minHeight?: number | undefined;
  maxHeight?: number | undefined;
}

export function clamp(
  value: number,
  min: number = 0,
  max: number = Number.POSITIVE_INFINITY,
): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Sets the iframe's `width`/`height` so that its viewport is `width` × `height` CSS px.
 * With `box-sizing: border-box`, the iframe's own border and padding are added.
 * Axes passed as `undefined` are left alone.
 */
export function applySize(
  iframe: HTMLIFrameElement,
  width: number | undefined,
  height: number | undefined,
): void {
  const style = iframe.ownerDocument.defaultView?.getComputedStyle(iframe);
  const extra = (...properties: string[]) => {
    if (style?.boxSizing !== 'border-box') return 0;
    let sum = 0;
    for (const property of properties)
      sum += Number.parseFloat(style.getPropertyValue(property)) || 0;
    return sum;
  };

  if (width !== undefined) {
    const sides = ['border-left-width', 'border-right-width', 'padding-left', 'padding-right'];
    iframe.style.width = `${width + extra(...sides)}px`;
  }
  if (height !== undefined) {
    const sides = ['border-top-width', 'border-bottom-width', 'padding-top', 'padding-bottom'];
    iframe.style.height = `${height + extra(...sides)}px`;
  }
}
