---
'react-iframe-kit': minor
---

New `react-iframe-kit/testing` entry with `mockChild(iframe, { methods })`, for testing components that talk to an iframe in jsdom or happy-dom. It plays the page inside the iframe over the real protocol: it answers the handshake and the parent's calls, calls the parent back through `remote`, and sends events, sizes (`resize`) and a title (`setTitle`). `dispose()` unloads it like a real page, so pending calls reject with `RIK_CONNECTION_LOST`.
