/**
 * Makes a document inert from the inside, the part of `useIframeInert` that `inert` on
 * the `<iframe>` doesn't cover. See docs/design.md → Inert.
 *
 * Returns the undo, which clears `inert` only if this call set it, so a page that made
 * its own body inert keeps it.
 */
export function makeDocumentInert(doc: Document): () => void {
  const body = doc.body;
  if (!body) return () => {};
  const setHere = !body.hasAttribute('inert');
  body.setAttribute('inert', '');
  // WebKit keeps delivering keys to an element focused before `inert` was set.
  (doc.activeElement as HTMLElement | null)?.blur();
  return () => {
    if (setHere) body.removeAttribute('inert');
  };
}
