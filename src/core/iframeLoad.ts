/**
 * Load state of any iframe, including one whose page doesn't run this library. See
 * docs/design.md → Third-party iframes.
 */

/** `'timeout'` isn't final: a later `load` still moves it to `'loaded'`. */
export type IframeLoadStatus = 'loading' | 'loaded' | 'timeout';

/**
 * Whether the iframe's document has finished loading, as far as the parent can tell.
 * A cross-origin document can't be read at all; that it's there (`contentDocument` is
 * `null` while `contentWindow` exists) means its navigation committed, and it counts as
 * loaded. Before that, every iframe holds an initial `about:blank`, which doesn't count
 * when a `src` or `srcdoc` is on its way.
 */
export function hasLoaded(iframe: HTMLIFrameElement): boolean {
  if (!iframe.contentWindow) return false; // not in a document
  const doc = iframe.contentDocument;
  if (!doc) return true;
  if (doc.readyState !== 'complete') return false;
  const src = iframe.getAttribute('src');
  const navigating =
    iframe.hasAttribute('srcdoc') || (src !== null && src !== '' && src !== 'about:blank');
  return !(navigating && doc.URL === 'about:blank');
}

/**
 * Reports `iframe`'s load status now and on every change: `'timeout'` when it hasn't
 * loaded within `timeoutMs` (`Infinity`: never). For `loading="lazy"`, the time starts
 * when the iframe first scrolls into view, since the browser doesn't load it before.
 * Returns the function that stops watching.
 */
export function observeIframeLoad(
  iframe: HTMLIFrameElement,
  timeoutMs: number,
  onChange: (status: IframeLoadStatus) => void,
): () => void {
  let status: IframeLoadStatus = hasLoaded(iframe) ? 'loaded' : 'loading';
  onChange(status);
  const set = (next: IframeLoadStatus) => {
    if (next === status) return;
    status = next;
    onChange(next);
  };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let observer: IntersectionObserver | undefined;
  const start = () => {
    if (timeoutMs < Infinity) timer = setTimeout(() => set('timeout'), timeoutMs);
  };
  if (status === 'loading') {
    if (iframe.loading === 'lazy' && typeof IntersectionObserver === 'function') {
      const lazy = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        lazy.disconnect();
        start();
      });
      lazy.observe(iframe);
      observer = lazy;
    } else {
      start();
    }
  }

  const onLoad = () => {
    clearTimeout(timer);
    observer?.disconnect();
    set('loaded');
  };
  iframe.addEventListener('load', onLoad);
  return () => {
    iframe.removeEventListener('load', onLoad);
    clearTimeout(timer);
    observer?.disconnect();
  };
}
