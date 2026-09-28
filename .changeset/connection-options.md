---
'react-iframe-kit': minor
---

`useIframeResize`, `useIframeEvent`, `useIframeTitle` and `useIframeInert` take `debug` too, like `useIframeRPC`: every parent hook now shares the same connection options, exported as `IframeConnectionOptions`. Before, a page that only resized an iframe had no way to log its protocol traffic.
