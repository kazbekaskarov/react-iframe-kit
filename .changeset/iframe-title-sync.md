---
'react-iframe-kit': minor
---

The page inside an iframe can share its title with the parent for screen readers: `connectToParent({ syncTitle: true })` (or `useParent`) sends `document.title` and every change to it, and the new `useIframeTitle(iframe)` hook returns it, for `<iframe title={title ?? 'Checkout'}>`. The new `title` protocol message is additive: older parents ignore it, and older children simply never send it.
