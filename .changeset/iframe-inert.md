---
'react-iframe-kit': minor
---

New `useIframeInert(iframe, inert)`: while `inert` is true, nothing inside the iframe can be clicked, focused or typed into. `inert` on the `<iframe>` alone lets keys through in Chromium and Safari, so the hook also makes the page inside inert: directly for a same-origin iframe or `<Frame>`, and through a new `inert` protocol message for a cross-origin page, which every `connectToParent` page now handles. The message is additive: older children ignore it and get only the attribute. `mockChild` gains an `inert` flag for tests.
