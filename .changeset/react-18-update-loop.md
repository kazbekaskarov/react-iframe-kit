---
'react-iframe-kit': patch
---

Fixed "Maximum update depth exceeded" on React 18 when a component uses several hooks on one iframe (for example `useIframeRPC`, `useIframeEvent` and `useIframeTitle`): each hook scheduled a same-value state update after every commit, which React 18 doesn't always discard. React 19 wasn't affected. CI now runs the end-to-end suite on React 18 as well.
