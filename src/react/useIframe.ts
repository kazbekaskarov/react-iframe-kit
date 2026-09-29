import { useCallback, useRef, useState } from 'react';
import { DEFAULT_SRCDOC, isFinalDocument, isSandboxedWithoutSameOrigin } from '../core/document';
import { IframeKitError } from '../core/errors';
import { POLICY_NAME, setSrcDoc, type TrustedHTMLLike } from '../core/srcdoc';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export interface UseIframeOptions {
  /**
   * Document to load into the iframe. Must be stable across renders: changing it
   * reloads the iframe. Defaults to an empty standards-mode document. On a page that
   * enforces Trusted Types, pass a `TrustedHTML`. See docs/design.md → Trusted Types.
   */
  srcDoc?: string | TrustedHTMLLike | undefined;
}

export interface UseIframeResult {
  /**
   * Spread onto the `<iframe>`. The `srcdoc` is set by the hook itself, not through
   * React, so that it can go through a Trusted Types policy.
   */
  frameProps: {
    ref: (iframe: HTMLIFrameElement | null) => void;
  };
  iframe: HTMLIFrameElement | null;
  /** `null` until the final document has loaded; updated on every `load`. */
  window: Window | null;
  /** `null` until the final document has loaded; updated on every `load`. */
  document: Document | null;
  /** Where to portal content: the final document's `<body>`, or `null`. */
  mountNode: HTMLElement | null;
  /**
   * Set instead of throwing: `RIK_INVALID_OPTIONS` for an unusable sandbox, or a
   * `srcdoc` the page's Trusted Types policy blocked.
   */
  error: IframeKitError | null;
}

interface Loaded {
  window: Window;
  document: Document;
}

/**
 * Headless primitive behind `<Frame>`: gives a same-origin iframe a standards-mode
 * document and reports it only once it has loaded, so portaled content doesn't go into
 * the temporary document that is replaced on load.
 * See docs/design.md → Portal mode.
 */
export function useIframe(options: UseIframeOptions = {}): UseIframeResult {
  const customSrcDoc = options.srcDoc !== undefined;
  const srcDoc = options.srcDoc ?? DEFAULT_SRCDOC;

  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<IframeKitError | null>(null);

  const ref = useCallback((node: HTMLIFrameElement | null) => setIframe(node), []);

  // Compared as text: a TrustedHTML may be a new object with the same content.
  const previousSrcDoc = useRef(String(srcDoc));
  if (__DEV__ && previousSrcDoc.current !== String(srcDoc)) {
    previousSrcDoc.current = String(srcDoc);
    console.warn(
      'react-iframe-kit: `srcDoc` changed, which reloads the iframe. Keep it stable (e.g. a module-level constant).',
    );
  }

  useIsomorphicLayoutEffect(() => {
    if (!iframe) {
      setLoaded(null);
      return;
    }
    if (isSandboxedWithoutSameOrigin(iframe)) {
      const sandboxError = new IframeKitError(
        'RIK_INVALID_OPTIONS',
        'react-iframe-kit: rendering into an iframe needs same-origin access, but its `sandbox` lacks `allow-same-origin`.',
      );
      console.error(sandboxError);
      setError(sandboxError);
      setLoaded(null);
      return;
    }

    try {
      setSrcDoc(iframe, srcDoc);
    } catch (cause) {
      const blockedError = new IframeKitError(
        'RIK_INVALID_OPTIONS',
        `react-iframe-kit: the page blocked the iframe's srcdoc. ${
          customSrcDoc
            ? 'Pass `srcDoc` as a TrustedHTML.'
            : `Allow the "${POLICY_NAME}" policy in \`trusted-types\`.`
        }`,
        { cause },
      );
      console.error(blockedError);
      setError(blockedError);
      setLoaded(null);
      return;
    }
    setError(null);

    // Runs now (the final document may already have loaded, e.g. before hydration)
    // and on every `load`, so reloads never leave React rendering into a dead document.
    // The listener is added in the same commit that received the element, before any
    // `load` task can run.
    const sync = () => {
      const doc = iframe.contentDocument;
      const view = doc?.defaultView ?? null;
      const next =
        doc && view && isFinalDocument(doc, customSrcDoc) ? { window: view, document: doc } : null;
      setLoaded((prev) => (prev?.document === next?.document ? prev : next));
    };
    sync();
    iframe.addEventListener('load', sync);
    return () => iframe.removeEventListener('load', sync);
  }, [iframe, srcDoc, customSrcDoc]);

  return {
    frameProps: { ref },
    iframe,
    window: loaded?.window ?? null,
    document: loaded?.document ?? null,
    mountNode: loaded?.document.body ?? null,
    error,
  };
}
