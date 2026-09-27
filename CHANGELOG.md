# react-iframe-kit

## 0.2.0

### Minor Changes

- f5a1140: Add the wire protocol, the parent↔child handshake, and `react-iframe-kit/child`'s `connectToParent`. `useIframeResize` now works with cross-origin iframes too: it picks up the child's `autoResize` reports over a private `MessagePort`, warns in dev if none arrive within 5 s, and — for a same-origin iframe whose page also runs `autoResize` — defers to the child's own reported size instead of measuring the DOM directly. The child entry ships as ESM, CJS and an IIFE (`dist/child.global.js`) for pages without a bundler. `debug: true` logs protocol traffic to the console on both sides.
- 54868d6: Add typed RPC and events between a page and its iframes. On the parent, `useIframeRPC` returns a `remote` for calling the iframe's methods, an `emit` for sending events, and the connection `status`; `useIframeEvent` subscribes to the iframe's events. In the iframe, `connectToParent` now takes `methods` and returns `remote`, `emit`, `on` and `whenConnected()`, and the new `react-iframe-kit/child/react` entry adds `useParent` and `useParentEvent`. Describe each side once with `Side<{ methods, events }>` to type both ends; function-typed arguments, return values and payloads, and the reserved method names `then`/`toJSON`, are compile errors. Calls made before the connection is up are queued (bounded by `connectTimeout`, default 30 s), each call has a response `timeout` (default 10 s, overridable per call with `withOptions`, including `Infinity` and an `AbortSignal`), errors arrive as `RemoteError` with the remote `code`, and `transfer()` marks values to transfer instead of copy. Parent bundles that only resize don't include the RPC code.
- 90b5124: Add `useIframeResize` and `<Frame resize>`: same-origin iframes follow their content's height (or width, with `axis`), with `min`/`max` limits, `apply: false` for report-only use and a custom `measure`. Hidden iframes keep their size instead of collapsing, and a feedback-loop guard stops content sized from the viewport (`100vh` plus a margin) from growing forever. `<Frame>` is now tree-shakable: importing only `useIframe` no longer pulls in the whole component.

### Patch Changes

- cfed627: Fix `copyStyles` under a nonce-based Content Security Policy in Firefox: copied `<style>` and `<link>` elements now carry the original's `nonce`, so a host policy like `style-src 'nonce-…'` (which the `<Frame>` document inherits) no longer blocks them.

## 0.1.0

### Minor Changes

- 5d29d5d: Add `<Frame>`, `useIframe` and `useFrame` for rendering React children into a same-origin iframe. Content is mounted only into the iframe's final, standards-mode document, so it never disappears when the document is replaced on load (facebook/react#22847), and it is remounted after every reload. `<Frame>` supports `head`, `copyStyles` (mirrors parent styles, including ones added later) and a custom `srcDoc`.
