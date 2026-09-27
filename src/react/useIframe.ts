import { useCallback, useRef, useState } from 'react';
import { DEFAULT_SRCDOC, isFinalDocument, isSandboxedWithoutSameOrigin } from '../core/document';
import { IframeKitError } from '../core/errors';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export interface UseIframeOptions {
  /**
   * Document to load into the iframe. Must be stable across renders: changing it
   * reloads the iframe. Defaults to an empty standards-mode document.
   */
  srcDoc?: string | undefined;
}

export interface UseIframeResult {
  /** Spread onto the `<iframe>`. */
  frameProps: {
    ref: (iframe: HTMLIFrameElement | null) => void;
    srcDoc: string;
  };
  iframe: HTMLIFrameElement | null;
  /** `null` until the final document has loaded; updated on every `load`. */
  window: Window | null;
  /** `null` until the final document has loaded; updated on every `load`. */
  document: Document | null;
  /** Where to portal content: the final document's `<body>`, or `null`. */
  mountNode: HTMLElement | null;
  /** Set instead of throwing, e.g. `RIK_INVALID_OPTIONS` for an unusable sandbox. */
  error: IframeKitError | null;
}

interface Loaded {
  window: Window;
  document: Document;
}

/**
 * Headless primitive behind `<Frame>`: gives a same-origin iframe a standards-mode
 * document and reports it only once it is the final one, so portaled content never
 * lands in a document that is replaced later (facebook/react#22847).
 * See docs/design.md → Portal mode.
 */
export function useIframe(options: UseIframeOptions = {}): UseIframeResult {
  const customSrcDoc = options.srcDoc !== undefined;
  const srcDoc = options.srcDoc ?? DEFAULT_SRCDOC;

  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<IframeKitError | null>(null);

  const ref = useCallback((node: HTMLIFrameElement | null) => setIframe(node), []);

  const previousSrcDoc = useRef(srcDoc);
  if (__DEV__ && previousSrcDoc.current !== srcDoc) {
    previousSrcDoc.current = srcDoc;
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
  }, [iframe, customSrcDoc]);

  return {
    frameProps: { ref, srcDoc },
    iframe,
    window: loaded?.window ?? null,
    document: loaded?.document ?? null,
    mountNode: loaded?.document.body ?? null,
    error,
  };
}
