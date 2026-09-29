# react-iframe-kit

## 0.3.0

### Minor Changes

- a59ee02: New `react-iframe-kit/child/lite` entry, for embedded pages that only need to be sized, titled or made inert: its `connectToParent` has no RPC and events, and weighs 4.1 kB gzipped instead of 6.3 kB. It also ships as `dist/child-lite.global.js` for `<script>` use. It shares the page's connection with the full `connectToParent`, so both can be used on one page, and a call from the parent to a lite page fails fast with `RIK_METHOD_NOT_FOUND`. The full `react-iframe-kit/child` is unchanged for its users.
- bda36e3: `useIframeResize`, `useIframeEvent`, `useIframeTitle` and `useIframeInert` take `debug` too, like `useIframeRPC`: every parent hook now shares the same connection options, exported as `IframeConnectionOptions`. Before, a page that only resized an iframe had no way to log its protocol traffic.
- e4f9d06: New `react-iframe-kit/devtools` entry. `connectReduxDevTools()` shows every protocol message on the page in the Redux DevTools browser extension, as an action named by its summary (`→ call getUser #q9x7c1`) with the message as payload, whether or not `debug` is on. `onProtocolMessage(listener)` gives the same stream for your own tooling, across every copy of the library on the page, and `summarizeProtocolMessage` is the one-line summary both use.
- 3315f5f: New `useIframeInert(iframe, inert)`: while `inert` is true, nothing inside the iframe can be clicked, focused or typed into. `inert` on the `<iframe>` alone lets keys through in Chromium and Safari, so the hook also makes the page inside inert: directly for a same-origin iframe or `<Frame>`, and through a new `inert` protocol message for a cross-origin page, which every `connectToParent` page now handles. The message is additive: older children ignore it and get only the attribute. `mockChild` gains an `inert` flag for tests.
- 8bd2a6b: The page inside an iframe can share its title with the parent for screen readers: `connectToParent({ syncTitle: true })` (or `useParent`) sends `document.title` and every change to it, and the new `useIframeTitle(iframe)` hook returns it, for `<iframe title={title ?? 'Checkout'}>`. The new `title` protocol message is additive: older parents ignore it, and older children simply never send it.
- 3042b69: New `react-iframe-kit/testing` entry with `mockChild(iframe, { methods })`, for testing components that talk to an iframe in jsdom or happy-dom. It plays the page inside the iframe over the real protocol: it answers the handshake and the parent's calls, calls the parent back through `remote`, and sends events, sizes (`resize`) and a title (`setTitle`). `dispose()` unloads it like a real page, so pending calls reject with `RIK_CONNECTION_LOST`.
- b24b396: `react-iframe-kit/testing` gets `mockParent()`, for testing the page inside an iframe (`connectToParent`, `useParent`, `useParentEvent`) in jsdom or happy-dom. It makes the test page look framed and plays its parent over the real protocol: it answers the handshake and the page's calls, calls the page through `remote`, exchanges events, and records the size and title the page reports. `dispose()` goes away like an unmounting parent, and the next `mockParent` reconnects the page.
- dca4c64: `<Frame>` and `useIframe` work on pages that enforce Trusted Types. The hook now sets the iframe's `srcdoc` itself, through a `react-iframe-kit` policy that can only create the library's empty default document; before, such a page threw during commit and took down the whole React tree. A custom `srcDoc` can be a `TrustedHTML`. A document the page still blocks is reported as `RIK_INVALID_OPTIONS` in `error` instead of throwing.
  
  Breaking for `useIframe` users: `frameProps` is now `{ ref }` without `srcDoc`, and the server-rendered `<iframe>` no longer has a `srcdoc` attribute (it is set on the client).

### Patch Changes

- 864c088: `<Frame>` warns in development about a missing or generic `title`, a `title` shared with another mounted `<Frame>`, and a negative `tabIndex`: the iframe accessibility problems axe-core reports as serious. The checks are removed from production builds.
- 864c088: `debug: true` logs are easier to read in development: each line starts with a summary such as `call getUser #q9x7c1` or `result #q9x7c1 ok (getUser, 12 ms)`, pairing every result with its call and showing how long it took. The message object is still logged after it. Production builds log as before.
- 38579f5: `useIframeResize` and `<Frame resize>` now apply a changed `minHeight`/`maxHeight`/`minWidth`/`maxWidth`, `axis` or `apply` immediately, instead of on the next content size change.
- 2d41f03: The `<script>` build of the child (`dist/child.global.js`) is 0.2 kB smaller gzipped: it no longer ships pure annotations, which only matter to a bundler. Production builds also stop reading `performance.now()` on every RPC call, which only the development build's `debug` timings use.

## 0.2.0

### Minor Changes

- f5a1140: Add the wire protocol, the parent↔child handshake, and `react-iframe-kit/child`'s `connectToParent`. `useIframeResize` now works with cross-origin iframes too: it picks up the child's `autoResize` reports over a private `MessagePort`, warns in dev if none arrive within 5 s, and — for a same-origin iframe whose page also runs `autoResize` — defers to the child's own reported size instead of measuring the DOM directly. The child entry ships as ESM, CJS and an IIFE (`dist/child.global.js`) for pages without a bundler. `debug: true` logs protocol traffic to the console on both sides.
- 54868d6: Add typed RPC and events between a page and its iframes. On the parent, `useIframeRPC` returns a `remote` for calling the iframe's methods, an `emit` for sending events, and the connection `status`; `useIframeEvent` subscribes to the iframe's events. In the iframe, `connectToParent` now takes `methods` and returns `remote`, `emit`, `on` and `whenConnected()`, and the new `react-iframe-kit/child/react` entry adds `useParent` and `useParentEvent`. Describe each side once with `Side<{ methods, events }>` to type both ends; function-typed arguments, return values and payloads, and the reserved method names `then`/`toJSON`, are compile errors. Calls made before the connection is up are queued (bounded by `connectTimeout`, default 30 s), each call has a response `timeout` (default 10 s, overridable per call with `withOptions`, including `Infinity` and an `AbortSignal`), errors arrive as `RemoteError` with the remote `code`, and `transfer()` marks values to transfer instead of copy. Parent bundles that only resize don't include the RPC code.
- 90b5124: Add `useIframeResize` and `<Frame resize>`: same-origin iframes follow their content's height (or width, with `axis`), with `min`/`max` limits, `apply: false` for report-only use and a custom `measure`. Hidden iframes keep their size instead of collapsing, and a feedback-loop guard stops content sized from the viewport (`100vh` plus a margin) from growing forever. `<Frame>` is now tree-shakable: importing only `useIframe` no longer pulls in the whole component.

### Patch Changes

- cfed627: Fix `copyStyles` under a nonce-based Content Security Policy in Firefox: copied `<style>` and `<link>` elements now carry the original's `nonce`, so a host policy like `style-src 'nonce-…'` (which the `<Frame>` document inherits) no longer blocks them.

## 0.1.0

### Minor Changes

- 5d29d5d: Add `<Frame>`, `useIframe` and `useFrame` for rendering React children into a same-origin iframe. Content is mounted only after the iframe's own standards-mode document has loaded, and it is remounted after every reload. `<Frame>` supports `head`, `copyStyles` (mirrors parent styles, including ones added later) and a custom `srcDoc`.
