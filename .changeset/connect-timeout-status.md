---
'react-iframe-kit': minor
---

`useIframeRPC` and `useParent` report `status: 'timeout'` once they've been `'connecting'` for longer than `connectTimeout` (default 30 s), so a host can show "the widget didn't load" (or a widget "open in a new tab") without a timer of its own. It isn't final: the status moves on to `'connected'` if the handshake completes later. For an iframe with `loading="lazy"`, the time counts from its first `load`, so widgets below the fold don't time out before they start loading. Code that switches exhaustively over `RPCStatus` or `ParentStatus` needs a case for the new value.
