---
'react-iframe-kit': patch
---

`useIframeResize` and `useIframeInert` no longer make Safari log "Blocked a frame … from accessing a frame" on every load of a cross-origin iframe: they read the iframe's document only when its `src` is on the page's own origin. Cross-origin iframes keep being sized from the page's own reports, as before.
