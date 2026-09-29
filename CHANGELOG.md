# react-iframe-kit

## 0.4.1

### Patch Changes

- b3ca194: Describe what portal mode does (it mounts only after the iframe's own document has loaded) instead of claiming that a React or browser issue is fixed, in the README and the `useIframe` documentation.

## 0.4.0

### Minor Changes

- 3ff30fe: `useIframeRPC` and `useParent` report `status: 'timeout'` once they've been `'connecting'` for longer than `connectTimeout` (default 30 s), so a host can show "the widget didn't load" (or a widget "open in a new tab") without a timer of its own. It isn't final: the status moves on to `'connected'` if the handshake completes later. For an iframe with `loading="lazy"`, the time counts from its first `load`, so widgets below the fold don't time out before they start loading. Code that switches exhaustively over `RPCStatus` or `ParentStatus` needs a case for the new value.
- 3ff30fe: New `react-iframe-kit/host` entry: `connectToIframe(iframe, options)`, the parent side without React, for host pages that aren't React apps, such as a white-label widget's loader script on customers' sites or a page moving off iframe-resizer. It resizes the iframe to the page's reports (`resize`, with `axis` and limits), carries typed calls and events, sets the iframe's `title` from the page (`syncTitle`), makes it inert (`setInert`), and reports `'connecting' | 'connected' | 'timeout'`. It shares the iframe's connection with any React hooks on it. Also ships as `dist/host.global.js` (global `ReactIframeKitHost`) for `<script>` use. The new "Embedding a widget" guide covers the whole white-label case: loader script, multi-tenant origins, theming, tokens, analytics, payments and cookies.
- 3ff30fe: New `useIframeLoad(target, { timeout })` for iframes whose pages don't run this library (a map, a video, a partner's app): `'idle' | 'loading' | 'loaded' | 'timeout'`, from the native `load` alone. `'timeout'` isn't final, and a `loading="lazy"` iframe's time starts when it scrolls into view. Parent hooks also warn in development about a `sandbox` with both `allow-scripts` and `allow-same-origin` on content from the page's own origin, which protects nothing. The new "Third-party iframes" guide covers load states, sizing and `sandbox`/`allow` choices per kind of content.
- 3ff30fe: `allowedOrigins` accepts predicates, `(origin) => boolean`, next to origin strings and `RegExp`s. That's for multi-tenant embeds such as a white-label widget, whose allowed hosts come from configuration: the predicate is asked on every handshake, so the list can change while the page is open. Only an exact `true` allows, so an async predicate (which returns a `Promise`) allows nothing. The Security guide has a new "Multi-tenant embeds" section, including per-tenant `frame-ancestors`.
- 3ff30fe: New `react-iframe-kit/validate` entry (0.7 kB) for runtime checks of what crosses the boundary, with any Standard Schema library (Zod, Valibot, ArkType, …). `validateArgs(schema, method)` validates a method's arguments as a tuple and rejects invalid ones with the new `RIK_VALIDATION` code, which the caller receives as a `RemoteError` with the issues in `cause.data`. `validatePayload(schema, handler)` drops an invalid event and reports it with `reportError`. Both pass the schema's output on, so transforms and defaults apply. The RPC guide has a new "Validating what arrives" section.

### Patch Changes

- 3ff30fe: The host no longer causes a "target origin does not match" console error on every page with a cross-origin iframe. Its handshake prompt was aimed at the page's expected origin while the iframe still held its initial `about:blank`; it now goes to any origin, which is safe because it carries nothing and the page's reply is still checked for source and origin.
- 3ff30fe: Fixed "Maximum update depth exceeded" on React 18 when a component uses several hooks on one iframe (for example `useIframeRPC`, `useIframeEvent` and `useIframeTitle`): each hook scheduled a same-value state update after every commit, which React 18 doesn't always discard. React 19 wasn't affected. CI now runs the end-to-end suite on React 18 as well.
- 3ff30fe: `useIframeResize`'s warnings (content overflowing `<html>`, a width axis the content can't follow, the feedback-loop guard, no size from a cross-origin child) are now development-only, like every other warning. The production build no longer carries their text or runs the 5 s "no size has arrived" timer, and a new package check fails the build if dev-only code ever reaches it again.
- 3ff30fe: `useIframeResize` and `useIframeInert` no longer make Safari log "Blocked a frame … from accessing a frame" on every load of a cross-origin iframe: they read the iframe's document only when its `src` is on the page's own origin. Cross-origin iframes keep being sized from the page's own reports, as before.

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
