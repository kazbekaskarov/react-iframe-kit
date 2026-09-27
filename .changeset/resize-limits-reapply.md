---
'react-iframe-kit': patch
---

`useIframeResize` and `<Frame resize>` now apply a changed `minHeight`/`maxHeight`/`minWidth`/`maxWidth`, `axis` or `apply` immediately, instead of on the next content size change.
