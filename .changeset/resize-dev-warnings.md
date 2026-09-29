---
'react-iframe-kit': patch
---

`useIframeResize`'s warnings (content overflowing `<html>`, a width axis the content can't follow, the feedback-loop guard, no size from a cross-origin child) are now development-only, like every other warning. The production build no longer carries their text or runs the 5 s "no size has arrived" timer, and a new package check fails the build if dev-only code ever reaches it again.
