---
'react-iframe-kit': minor
---

`react-iframe-kit/testing` gets `mockParent()`, for testing the page inside an iframe (`connectToParent`, `useParent`, `useParentEvent`) in jsdom or happy-dom. It makes the test page look framed and plays its parent over the real protocol: it answers the handshake and the page's calls, calls the page through `remote`, exchanges events, and records the size and title the page reports. `dispose()` goes away like an unmounting parent, and the next `mockParent` reconnects the page.
