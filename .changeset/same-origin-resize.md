---
'react-iframe-kit': minor
---

Add `useIframeResize` and `<Frame resize>`: same-origin iframes follow their content's height (or width, with `axis`), with `min`/`max` limits, `apply: false` for report-only use and a custom `measure`. Hidden iframes keep their size instead of collapsing, and a feedback-loop guard stops content sized from the viewport (`100vh` plus a margin) from growing forever. `<Frame>` is now tree-shakable: importing only `useIframe` no longer pulls in the whole component.
