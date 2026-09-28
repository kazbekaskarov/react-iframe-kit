---
'react-iframe-kit': minor
---

New `react-iframe-kit/devtools` entry. `connectReduxDevTools()` shows every protocol message on the page in the Redux DevTools browser extension, as an action named by its summary (`→ call getUser #q9x7c1`) with the message as payload, whether or not `debug` is on. `onProtocolMessage(listener)` gives the same stream for your own tooling, across every copy of the library on the page, and `summarizeProtocolMessage` is the one-line summary both use.
