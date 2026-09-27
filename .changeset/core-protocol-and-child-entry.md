---
'react-iframe-kit': minor
---

Add the wire protocol, the parent↔child handshake, and `react-iframe-kit/child`'s `connectToParent`. `useIframeResize` now works with cross-origin iframes too: it picks up the child's `autoResize` reports over a private `MessagePort`, warns in dev if none arrive within 5 s, and — for a same-origin iframe whose page also runs `autoResize` — defers to the child's own reported size instead of measuring the DOM directly. The child entry ships as ESM, CJS and an IIFE (`dist/child.global.js`) for pages without a bundler. `debug: true` logs protocol traffic to the console on both sides.
