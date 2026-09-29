---
'react-iframe-kit': minor
---

New `useIframeLoad(target, { timeout })` for iframes whose pages don't run this library (a map, a video, a partner's app): `'idle' | 'loading' | 'loaded' | 'timeout'`, from the native `load` alone. `'timeout'` isn't final, and a `loading="lazy"` iframe's time starts when it scrolls into view. Parent hooks also warn in development about a `sandbox` with both `allow-scripts` and `allow-same-origin` on content from the page's own origin, which protects nothing. The new "Third-party iframes" guide covers load states, sizing and `sandbox`/`allow` choices per kind of content.
