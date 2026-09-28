import { useRef } from 'react';
import { makeDocumentInert } from '../core/inert';
import { acquireParentConnection, type ParentConnection } from '../core/parentConnection';
import type { IframeConnectionOptions } from './connectionOptions';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

/** The iframe's connection options, shared with the other hooks on it. */
export interface UseIframeInertOptions extends IframeConnectionOptions {}

/**
 * While `inert` is true, nothing inside the iframe can be clicked, focused or typed
 * into. See docs/design.md → Inert.
 *
 * `inert` on the `<iframe>` alone blocks clicks and Tab, but in Chromium and WebKit
 * keys still reach an element that was focused inside, or that the page focuses
 * itself. So the page inside is made inert too: directly when it's same-origin (e.g. a
 * `<Frame>`), otherwise by the page itself when it runs `connectToParent`.
 *
 * The hook owns the iframe's `inert` attribute while it's on; don't also pass `inert`.
 */
export function useIframeInert(
  target: IframeTarget,
  inert: boolean,
  options: UseIframeInertOptions = {},
): void {
  const iframe = useIframeTarget(target);

  const optionsRef = useRef(options);
  useIsomorphicLayoutEffect(() => {
    optionsRef.current = options;
  });

  // The connection lives as long as the iframe, not per toggle.
  const connection = useRef<ParentConnection | null>(null);
  useIsomorphicLayoutEffect(() => {
    if (!iframe) return;
    const { origin, unsafeAllowAnyOrigin, debug } = optionsRef.current;
    try {
      connection.current = acquireParentConnection(iframe, { origin, unsafeAllowAnyOrigin, debug });
    } catch (error) {
      console.error(error);
      return;
    }
    const acquired = connection.current;
    return () => {
      acquired.release();
      connection.current = null;
    };
  }, [iframe]);

  useIsomorphicLayoutEffect(() => {
    if (!iframe || !inert) return;
    const setHere = !iframe.hasAttribute('inert');
    // No `iframe.blur()` here: in WebKit it leaves the page's `activeElement` reading
    // `body` while keys still reach the element that had focus, and then the page's own
    // blur (in `makeDocumentInert`) can't find that element any more.
    iframe.setAttribute('inert', '');

    // Same-origin: the document inside, reapplied to every document the iframe loads.
    let undoDocument: (() => void) | undefined;
    const applyToDocument = () => {
      undoDocument?.();
      let doc: Document | null = null;
      try {
        doc = iframe.contentDocument;
      } catch {
        // Cross-origin: the page does it itself, when told over the connection.
      }
      undoDocument = doc ? makeDocumentInert(doc) : undefined;
    };
    applyToDocument();
    iframe.addEventListener('load', applyToDocument);

    const user = {};
    const current = connection.current;
    current?.setInert(user, true);
    return () => {
      current?.setInert(user, false);
      iframe.removeEventListener('load', applyToDocument);
      undoDocument?.();
      if (setHere) iframe.removeAttribute('inert');
    };
  }, [iframe, inert]);
}
