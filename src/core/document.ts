/**
 * Which iframe document is safe to render into. See docs/design.md → Portal mode and
 * document replacement.
 */

/** Marks the body of the library's default srcdoc document. */
export const ROOT_MARKER = 'data-rik-root';

/**
 * Default iframe document. A srcdoc (instead of the initial about:blank) gives a
 * document in standards mode; about:blank is in quirks mode, which silently breaks CSS.
 */
export const DEFAULT_SRCDOC: string = `<!DOCTYPE html><html><head></head><body ${ROOT_MARKER}></body></html>`;

/**
 * True once `doc` is the document the srcdoc navigation produced, as opposed to the
 * initial about:blank that browsers create on insertion and may replace later.
 *
 * @param customSrcDoc the iframe uses a caller-provided srcdoc, which has no marker.
 */
export function isFinalDocument(doc: Document, customSrcDoc: boolean): boolean {
  return (
    doc.readyState === 'complete' &&
    doc.URL === 'about:srcdoc' &&
    doc.body !== null &&
    (customSrcDoc || doc.body.hasAttribute(ROOT_MARKER))
  );
}

/** Portal mode needs same-origin access, which a sandbox without the flag removes. */
export function isSandboxedWithoutSameOrigin(iframe: HTMLIFrameElement): boolean {
  return iframe.hasAttribute('sandbox') && !iframe.sandbox.contains('allow-same-origin');
}
