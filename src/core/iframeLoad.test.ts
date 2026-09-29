import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hasLoaded, observeIframeLoad } from './iframeLoad';

/** An iframe whose `contentWindow`/`contentDocument` read as given. */
function frame(
  documentState: { readyState?: DocumentReadyState; URL?: string } | null | 'detached',
  attributes: Record<string, string> = {},
): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  for (const [name, value] of Object.entries(attributes)) iframe.setAttribute(name, value);
  if (attributes['loading']) iframe.loading = attributes['loading'] as 'lazy'; // happy-dom doesn't reflect it
  Object.defineProperty(iframe, 'contentWindow', {
    get: () => (documentState === 'detached' ? null : {}),
  });
  Object.defineProperty(iframe, 'contentDocument', {
    get: () =>
      documentState === 'detached' || documentState === null
        ? null
        : { readyState: 'complete', URL: 'about:blank', ...documentState },
  });
  return iframe;
}

describe('hasLoaded', () => {
  it('is false without a window (not in a document)', () => {
    expect(hasLoaded(frame('detached'))).toBe(false);
  });

  it('is true for a cross-origin document, which the parent cannot read', () => {
    expect(hasLoaded(frame(null, { src: 'https://maps.example.com/' }))).toBe(true);
  });

  it('is false while the document is still loading', () => {
    expect(hasLoaded(frame({ readyState: 'interactive', URL: 'https://a.test/' }))).toBe(false);
  });

  it('does not count the initial about:blank when a src or srcdoc is on its way', () => {
    expect(hasLoaded(frame({}, { src: '/page' }))).toBe(false);
    expect(hasLoaded(frame({}, { srcdoc: '<p>x</p>' }))).toBe(false);
    expect(hasLoaded(frame({ URL: `${location.origin}/page` }, { src: '/page' }))).toBe(true);
  });

  it('counts about:blank when that is all the iframe will ever show', () => {
    expect(hasLoaded(frame({}))).toBe(true);
    expect(hasLoaded(frame({}, { src: '' }))).toBe(true);
    expect(hasLoaded(frame({}, { src: 'about:blank' }))).toBe(true);
  });
});

describe('observeIframeLoad', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('reports loading, then loaded on load', () => {
    const iframe = frame('detached');
    const seen: string[] = [];
    observeIframeLoad(iframe, 100, (status) => seen.push(status));
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['loading', 'loaded']);
  });

  it('reports an iframe that already loaded right away, with no timer', () => {
    const seen: string[] = [];
    observeIframeLoad(frame(null), 100, (status) => seen.push(status));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['loaded']);
  });

  it('times out, and still moves on to loaded', () => {
    const iframe = frame('detached');
    const seen: string[] = [];
    observeIframeLoad(iframe, 100, (status) => seen.push(status));
    vi.advanceTimersByTime(100);
    iframe.dispatchEvent(new Event('load'));
    iframe.dispatchEvent(new Event('load'));
    expect(seen).toEqual(['loading', 'timeout', 'loaded']);
  });

  it('never times out with Infinity', () => {
    const seen: string[] = [];
    observeIframeLoad(frame('detached'), Infinity, (status) => seen.push(status));
    vi.advanceTimersByTime(1e9);
    expect(seen).toEqual(['loading']);
  });

  it('starts a lazy iframe’s time when it scrolls into view', () => {
    let callback: IntersectionObserverCallback = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe() {}
        disconnect = disconnect;
      },
    );
    const iframe = frame('detached', { loading: 'lazy' });
    const seen: string[] = [];
    observeIframeLoad(iframe, 100, (status) => seen.push(status));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['loading']);
    const observer = {} as IntersectionObserver;
    callback([{ isIntersecting: false } as IntersectionObserverEntry], observer);
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['loading']);
    callback([{ isIntersecting: true } as IntersectionObserverEntry], observer);
    expect(disconnect).toHaveBeenCalled();
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(['loading', 'timeout']);
  });

  it('falls back to a plain timer for lazy iframes without IntersectionObserver', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    const seen: string[] = [];
    observeIframeLoad(frame('detached', { loading: 'lazy' }), 100, (status) => seen.push(status));
    vi.advanceTimersByTime(100);
    expect(seen).toEqual(['loading', 'timeout']);
  });

  it('stops watching', () => {
    const iframe = frame('detached');
    const seen: string[] = [];
    const stop = observeIframeLoad(iframe, 100, (status) => seen.push(status));
    stop();
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1000);
    expect(seen).toEqual(['loading']);
  });
});
