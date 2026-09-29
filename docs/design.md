# react-iframe-kit — Design

> Status: draft, pre-v1. This document is the source of truth for the wire protocol
> and public API. Changes to either should update this file in the same PR.

## Goals

One TypeScript-first, hooks-first React library for the three things that are
currently spread across separate packages:

| Concern | Prior art | Here |
|---|---|---|
| Render React children into an iframe | react-frame-component | `<Frame>`, `useIframe` |
| Size the iframe to its content | iframe-resizer | `useIframeResize`, `<Frame resize>`, child `autoResize` |
| Typed messaging between parent and iframe | Penpal, Comlink | `useIframeRPC`, `useIframeEvent`, `connectToParent` |

All three share one connection per iframe, so using resize and RPC together costs
a single handshake.

### Non-goals

- Wire compatibility with iframe-resizer or Penpal.
- Deep, Comlink-style proxies. `remote` is a flat method map (one level, see
  [RPC](#rpc-and-events-api)); nested objects, functions and callbacks never cross
  the boundary.
- Rendering into cross-origin iframes (impossible by design; use RPC instead).
- Popups (`window.opener`), workers, and relaying through nested frames. v1 covers
  parent ↔ direct child iframe only.
  - Plain nesting still works: a page can be a child of its parent and a parent of
    its own iframes at the same time. Each link is an independent connection; the
    child role only accepts `ack`/`syn` from `window.parent`. What is out of scope is
    routing messages across several levels.

## Compatibility

- React `>=18` (peer dependency). CI runs the suite against React 18 and 19.
- Browsers: last 2 versions of Chrome, Edge, Firefox; Safari ≥ 15.4. Output target
  ES2020. Required APIs: `MessageChannel`, `ResizeObserver`, `MutationObserver`.
- **Independent deploys are the normal case.** The host app and the embedded page
  are usually released separately and run different versions of this library. The
  wire protocol is therefore versioned independently of the npm package
  (see [Versioning](#versioning)).

## Package layout

One npm package, subpath exports:

| Entry | Runs in | Depends on React | Contents |
|---|---|---|---|
| `react-iframe-kit` | parent | yes | `<Frame>`, `useFrame`, `useIframe`, `useIframeResize`, `useIframeRPC`, `useIframeEvent`, `useIframeTitle`, `useIframeInert`, `transfer`, `withOptions`, errors, types |
| `react-iframe-kit/child` | iframe | no | `connectToParent`, `transfer`, `withOptions`, errors, types |
| `react-iframe-kit/child/lite` | iframe | no | `connectToParent` without RPC and events (`autoResize`, `syncTitle`, inert), `IframeKitError`, `isIframeKitError`, types |
| `react-iframe-kit/child/react` | iframe | yes | `useParent`, `useParentEvent` |
| `react-iframe-kit/validate` | either | no | `validateArgs`, `validatePayload`, see [Validation](#validation) |
| `react-iframe-kit/host` | parent | no | `connectToIframe`, `transfer`, `withOptions`, errors, types, see [Host without React](#host-without-react) |
| `react-iframe-kit/testing` | tests (jsdom, happy-dom) | no | `mockChild`, `mockParent`, see [Testing utilities](#testing-utilities) |
| `react-iframe-kit/devtools` | either page, in development | no | `onProtocolMessage`, `connectReduxDevTools`, `summarizeProtocolMessage`, see [Devtools](#devtools) |

The `child` entry also ships as an IIFE build (`dist/child.global.js`, global
`ReactIframeKit`) for embedded pages that don't use a bundler (served via
jsDelivr/unpkg), and so does `child/lite` (`dist/child-lite.global.js`, same global).
`host` has one too (`dist/host.global.js`), under its own global `ReactIframeKitHost`, so
that a page which is both (a host inside someone else's iframe) can load both scripts.

`child/lite` is for embedded pages that only need to be sized, titled and made inert:
its `connectToParent` has the same options minus `methods`/`timeout`/
`connectTimeout`, and a handle without `remote`/`emit`/`on`. It shares the page's one
connection with the full `connectToParent`, so both can be used on a page (e.g. a
lite `<script>` plus a React island with `useParent`); the RPC engine is created by
the first full caller, connected at once if the handshake is already done. On a page
with no engine, an incoming `call` is answered with `RIK_METHOD_NOT_FOUND`, as on a
parent without one, so the parent's call fails fast instead of timing out.

Internally, `src/core/` is framework-agnostic (protocol, handshake, RPC, events,
size measurement). React code in `src/react/` only adapts core to hooks. This keeps
core fully unit-testable and makes future Vue/Svelte adapters cheap.

- `sideEffects: false`; ESM-first with CJS fallback.
- `'use client'` is emitted only at the top of entries that use hooks.
- Dev-only checks and warnings live in a separate build selected by the
  `development` export condition, which Vite, webpack 5, Next.js and Vitest set in
  dev. The `default` condition resolves to the production build, which contains no
  dev code and no `process` references. It is therefore safe as unbundled ESM, and
  the IIFE is built from it. The build does not rely on a
  `typeof process !== 'undefined'` guard: under Vite that guard is always false
  in the browser and would silently switch off every dev warning.
- **Duplicate copies on one page are expected.** An embeddable SDK may bundle its
  own copy of the library, and ESM and CJS copies can load side by side. All
  copies with the same protocol major share one parent connection registry and one
  child singleton. Both live on `globalThis` under
  `Symbol.for('react-iframe-kit/v1')`. Without this, two copies would open two
  connections to one iframe, and their sessions would keep replacing each other
  in a reconnect loop.
  - Copies of *different library versions* then call into each other's objects.
    The object stored under the key is therefore a small, documented internal
    interface (acquire/release, send, subscribe), frozen for the lifetime of the
    key. An incompatible change to it means a new key (`/v2`).
  - `FrameContext` is created once and stored in the same place. `useFrame` from one
    copy then works inside a `<Frame>` from another.
  - Error classes may also exist in several copies: one per library copy, and one
    per entry if the bundler duplicates them. `instanceof` therefore goes through a
    `static [Symbol.hasInstance]` that checks a global brand
    (`Symbol.for('react-iframe-kit/error')`) and `code`. It works across copies,
    entries and versions. `isIframeKitError(e)` is exported for code that avoids
    `instanceof`. Within one copy, entries share core through common chunks
    rather than duplicating it.

Size budgets (min+gzip, React excluded, enforced by size-limit per import scenario;
`.size-limit.json` is the source of truth):

| Scenario | Budget | Measured |
|---|---|---|
| `useIframe` only | ≤ 1.5 kB | 1.25 kB |
| `useIframeResize` only (pulls in the handshake/connection, not RPC) | ≤ 5 kB | 4.53 kB |
| `<Frame>` (portal + resize + copyStyles) | ≤ 6.75 kB | 6.13 kB |
| `useIframeRPC` + `useIframeEvent` | ≤ 6.5 kB | 6.27 kB |
| entire parent entry | ≤ 10.5 kB | 10.08 kB |
| `child` entry (`connectToParent` with RPC + `autoResize` + `syncTitle` + inert) | ≤ 6.5 kB | 6.35 kB |
| `child/lite` entry (the same without RPC and events) | ≤ 4.25 kB | 4.21 kB |
| `child/react` entry (`useParent`, `useParentEvent`) | ≤ 7.3 kB | 7.27 kB |
| `child` IIFE | ≤ 6.5 kB | 6.33 kB |
| `child/lite` IIFE | ≤ 4.25 kB | 4.18 kB |
| `host` entry (`connectToIframe`, with RPC) | ≤ 6.25 kB | 5.96 kB |
| `host` IIFE | ≤ 6.25 kB | 5.97 kB |
| `validate` entry | ≤ 1 kB | 0.68 kB |
| `devtools` entry | ≤ 1 kB | 0.72 kB |

The [Devtools](#devtools) listener check in the shared message path costs every entry
about 0.05 kB; the summaries and the adapter stay in `devtools`.

`<Frame>` is the batteries-included component; size-sensitive users build on
`useIframe`. Module-level calls such as `forwardRef(...)` must be marked
`/* @__PURE__ */`, otherwise bundlers keep them and tree-shaking of the entry breaks.
`useIframe` grew from 0.91 kB (budget 1 kB) when it took over setting `srcdoc`
through a Trusted Types policy (see [Trusted Types](#trusted-types)); the budgets for
it and the parent entry were raised to 1.5 kB and 10 kB.
`useIframeResize` jumped from step 4's 1.51 kB because it now always acquires a
connection (needed for cross-origin and for the same-origin "child also runs
autoResize" override, see [Applying](#applying-parent)) — the handshake/connection
code is no longer resize-only. RPC + events (step 6) reuse this same connection
rather than adding a second protocol layer. On the parent side the RPC engine
(`src/core/rpc.ts`, ~2 kB) is not imported by the connection: `useIframeRPC` and
`useIframeEvent` pass the engine class in on their first acquire, so resize-only
users pay only for parsing the three extra message types (+0.2 kB). A connection
with no engine answers an incoming `call` with `RIK_METHOD_NOT_FOUND` itself. The
child can't do the same: every `connectToParent` handle has `remote`/`emit`/`on`,
so the `child` entry and IIFE grew by about 2.7 kB.
[Title](#title) sync added about 0.2 kB to the child, which can't be tree-shaken for
the same reason (`syncTitle` is an option, not an import); the `child` entry and IIFE
budgets were raised from 6 kB to 6.25 kB.
[Inert](#inert) added about 0.1 kB to the child (handling the message, always on) and
to the shared parent connection, which every hook pulls in. `<Frame>` crossed its
budget by a few bytes and the whole parent entry (which now also has the hook) by
0.1 kB, so the budgets for `<Frame>`, the parent entry and `child/react` were raised to
6.75, 10.5 and 7.25 kB.
That left the `child` entry and IIFE within 0.05 kB of their budgets, and every child
feature paying for RPC. So the child connection no longer imports the engine either:
`connectToParent` (now in `src/core/connectToParent.ts`, the only child module that
imports `rpc.ts`) passes it in, as the parent hooks do, and `child/lite` never does.
A page that only resizes now ships 4.13 kB instead of 6.28. The split itself cost the
full entry 0.05 kB (the engine-less `call` answer, the lazy engine), which took it
over 6.25 kB; its budget and the IIFE's were raised to 6.5 kB, and `child/lite` got a
tight 4.25 kB of its own.
The `'timeout'` status (see [Behaviour](#behaviour)) put `child/react` 2 bytes over, and
its budget was raised to 7.3 kB. The parent hooks absorbed it: making every
`useIframeResize` warning dev-only took 0.4 kB out of every parent scenario.

## Host without React

The parent hooks cover a React host. The white-label case is the opposite: the widget
vendor ships a script, and it runs on customers' sites, which are rarely React apps
(pretix, Tito, Calendly and Stripe all embed this way). Without a non-React host, a
vendor using this library for its widget would still have to write the host side of the
protocol itself. The same holds for moving off iframe-resizer, whose host script is plain
JavaScript. So `react-iframe-kit/host` exposes the parent connection directly:

```ts
import { connectToIframe } from 'react-iframe-kit/host';

const widget = connectToIframe<WidgetSide, HostSide>(iframe, {
  origin: 'https://tickets.example.com', // optional: derived from src otherwise
  methods: { getToken },
  resize: { maxHeight: 2000 },           // true: height only
  syncTitle: true,                       // iframe's title attribute = the page's title
  onStatusChange(status) {},             // 'connecting' | 'connected' | 'timeout'
  onResize(size) {},
});
await widget.remote.setTheme('dark');
widget.on('orderCompleted', track);
widget.setInert(true);
widget.dispose();
```

- **The same connection as the hooks.** `connectToIframe` acquires the iframe's shared
  parent connection (see [Connection sharing](#connection-sharing)) and an RPC handle
  of its own, so it can sit next to React hooks on the same iframe, and several copies
  of the library still share one connection.
- **Callbacks in the options, state in getters** (`status`, `size`, `title`), which is
  what a loader script needs, and what iframe-resizer users know. Events of the page
  use `on()`, as on the child.
- **Imperative error policy:** invalid options throw synchronously, like the child's
  `connectToParent`.
- **`status`** has the hooks' `'timeout'` (see [Behaviour](#behaviour)), with the same
  rules; `watchConnectDeadline` (`src/core/connectDeadline.ts`) is shared with
  `useIframeRPC`.
- **Resize follows the page's reports only.** There is no direct measurement of a
  same-origin document, which `useIframeResize` does: a host page without React embeds
  pages it doesn't render, and those run `autoResize`. The limits and `axis` work as in
  the hook, and `onResizeLoop` fires when the page's guard trips.
- **`syncTitle` sets the attribute itself.** The hook can't (React owns `title`); a plain
  page has no such owner. The original `title` comes back when the page stops sending
  one and on `dispose()`.
- **`setInert`** sets the `inert` attribute (and removes only one it set) and tells the
  page, as `useIframeInert` does for a cross-origin iframe.
- Covered by `src/core/connectToIframe.test.ts` (against `mockChild`) and
  `e2e/host.spec.ts`, which runs a real cross-origin widget under a host page without
  React, from the sources and from the `<script>` build, in every engine.

## Third-party iframes

Everything above needs the page inside to cooperate (`connectToParent`), except
portals. Embedding a page you don't control (a map, a video, a partner's app, a payment
form) leaves the parent with very little, and the library says so rather than pretending:

- **`useIframeLoad(target, { timeout })`** → `'idle' | 'loading' | 'loaded' | 'timeout'`,
  from the native `load` alone (`src/core/iframeLoad.ts`). It needs nothing inside the
  iframe and opens no connection.
  - Already loaded at mount counts: a readable document that is `complete` and isn't
    the initial `about:blank` of an iframe with a `src`/`srcdoc` on its way, or a
    cross-origin document (`contentDocument` is `null` while `contentWindow` exists),
    whose navigation has committed. The latter may still be loading; its `load` then
    arrives anyway, so the only cost is reporting `loaded` a little early.
  - `'timeout'` isn't final: a later `load` moves it to `'loaded'`.
  - For `loading="lazy"`, time counts from when the iframe first intersects the
    viewport (an `IntersectionObserver`): off screen the browser doesn't load it, and a
    timer from mount would time out every lazy iframe below the fold. Without
    `IntersectionObserver`, it falls back to a plain timer.
  - `loaded` means the browser finished loading *a* document. An error page, or a page
    that refuses to be framed, may fire `load` too, and a cross-origin parent can't tell
    the difference. The docs say so; only a handshake (`useIframeRPC`'s status) proves a
    cooperating page works.
  - Covered by `src/core/iframeLoad.test.ts` and `e2e/third-party.spec.ts` (a real
    cross-origin page that knows nothing about the library, a server that never answers,
    and a lazy iframe far below the fold), in every engine.
- **Size:** a non-cooperating cross-origin page can't be measured. The guide recommends
  a fixed size or `aspect-ratio`.
- **`sandbox`:** every parent connection checks, in development, for `allow-scripts` +
  `allow-same-origin` on content from the page's own origin, which the framed script can
  undo, and warns once per iframe (`src/core/sandbox.ts`). The docs have a table of
  `sandbox`/`allow`/`referrerpolicy` choices per kind of content; presets as code would
  freeze opinions into the API for little gain.

## Two modes

| | Same-origin (portal) | Cross-origin (`src=URL`) |
|---|---|---|
| Rendering | `createPortal` into the iframe document | the embedded page renders itself |
| Resize | parent measures the iframe document directly | child measures itself and reports over the port |
| RPC / events | not needed (shared JS realm), but supported | over the handshake-established `MessagePort` |
| Code inside iframe | none | `react-iframe-kit/child` |

**Mode detection happens after each native `load` of the iframe, never earlier.**
Before the first `load`, every iframe holds an initial `about:blank` that inherits
the parent's origin, so `contentDocument` is readable even when `src` is
cross-origin. Detecting at that point would pick the wrong mode; it is the same
class of bug as facebook/react#22847. On every `load`:

- `contentDocument` readable → same-origin mode;
- `contentDocument` is `null` or access throws → cross-origin mode.

The mode is re-evaluated on every `load`, because the iframe may navigate across
origins.

The document is only read when the iframe's `src` (or `srcdoc`) puts it on the page's
own origin (`readableFromSrc` in `src/core/origin.ts`). WebKit logs a security error for
every read of another origin's `contentDocument`, even a caught one, and resize and
inert re-read on every `load`: a host page with a cross-origin widget got one error per
load in Safari. A `src` that redirects back to the page's origin is then handled as
cross-origin, which works as long as the page inside reports its size. The e2e specs for
cross-origin resize, inert, the host entry and third-party iframes fail on any console
error (`e2e/console.ts`).

## Portal mode and the Firefox fix (facebook/react#22847)

**Bug:** when an `<iframe>` is inserted, browsers create an initial `about:blank`
document synchronously. If React portals into that document (e.g. from a ref callback)
and the iframe's document is replaced afterwards, the portaled content disappears
silently: React keeps rendering into a detached document, and nothing is logged.

**Where it happens** (measured 2026-09-27 with Playwright's Firefox builds, see
`e2e/firefox-22847.spec.ts`):

| Situation | Affected |
|---|---|
| iframe without `src` or with `src="about:blank"` (the case in #22847) | Firefox ≤ 146, which still includes **Firefox ESR 140** (and Tor Browser, which is based on ESR). Fixed in Firefox 147/148; Chromium and WebKit never replaced the document. |
| iframe with `srcdoc`, portaled before `load` | **Every browser**: navigating to the srcdoc always replaces the initial document. |

So the naive pattern is still broken for part of Firefox users, and anyone who adds a
`srcdoc` (needed for standards mode, see below) hits the same race in all browsers. The
fix below covers both.

**Fix:**

1. The iframe is given a `srcdoc` (`<!DOCTYPE html>…<body data-rik-root>`). This also
   puts the document in standards mode. `about:blank` is quirks mode, which silently
   breaks CSS. The hook sets `srcdoc` on the element itself in its layout effect, not
   as a React prop, so that it can go through a Trusted Types policy (see
   [Trusted Types](#trusted-types)). It skips the assignment when the attribute
   already holds that document, so a re-run effect doesn't reload the iframe.
2. The mount node is taken only after the native `load` event for that document. The
   listener is attached natively, not via React's `onLoad`, in a layout effect of the
   same commit that receives the element: state set from a ref callback is flushed
   synchronously in that commit, so no `load` task can run in between.
3. Fallback: if the document is already the final one, mount immediately. "Final"
   means `readyState === 'complete'`, `URL === 'about:srcdoc'`, and, for the default
   srcdoc, the `data-rik-root` marker on `<body>` (`isFinalDocument` in
   `src/core/document.ts`). `load` may already have fired, for example when the
   effect re-runs for a new `srcDoc` value with the same content (a fresh
   `TrustedHTML` object) after the document has loaded.
4. The mount node is recomputed on **every** `load`, so reloads and navigation don't
   leave React rendering into a dead document.

`e2e/firefox-22847.spec.ts` covers this in all three engines: it forces a document
replacement with `srcdoc`, checks that mounting after the native `load` keeps the
content, and keeps a canary asserting that mounting before `load` loses it. The Firefox
≤ 146 case can't run in CI (current Playwright can't drive old Firefox builds); it was
checked manually with Firefox 128, 140, 142 and 146 (bug present) and 148, 150, 153,
155 (fixed).

Constraints:

- The `srcdoc` string must be stable: changing it reloads the iframe. A user-supplied
  `srcDoc` must not be rebuilt on every render.
- Portal mode needs same-origin access, and a `sandbox` without `allow-same-origin`
  makes it impossible. `useIframe` then reports `error` (`RIK_INVALID_OPTIONS`) and
  `<Frame>` renders nothing into the iframe and logs `console.error`. The
  behaviour is the same in dev and prod. See [Error policy](#error-policy).

### `useIframe` (headless primitive)

```tsx
const { frameProps, iframe, window, document, mountNode, error } = useIframe({ srcDoc });

return (
  <>
    <iframe {...frameProps} title="Preview" />
    {mountNode && createPortal(children, mountNode)}
  </>
);
```

- `frameProps` is `{ ref }` and must be spread onto the `<iframe>`. The hook sets
  `srcdoc` itself; see [Trusted Types](#trusted-types).
- `window`, `document` and `mountNode` are `null` until the final document has
  loaded, and update on every `load`.
- `srcDoc` is optional; the default is the marker document from step 1. It may be a
  string or a `TrustedHTML` (typed structurally as `TrustedHTMLLike`, because
  TypeScript's `lib.dom` only gained `TrustedHTML` after 5.6).

### `<Frame>`

`<Frame>` is `useIframe` plus context and conveniences. Props:

- `children`: rendered into the iframe `<body>`.
- `head`: nodes rendered into the iframe `<head>`.
- `copyStyles`: see below.
- `resize`: `boolean | ResizeOptions`, shorthand for `useIframeResize` on the same
  element.
- All other `<iframe>` attributes are forwarded. `ref` points at the iframe element.
  One build serves React 18 and 19, so this uses `forwardRef`, which works on both.
- With `resize`, the resized axis is owned by the library. A `height`/`width` in
  `style` is used only as the size before the first measurement, and a dev warning
  says so.
- Dev warnings for accessibility, after axe-core's `frame-title`,
  `frame-title-unique` and `frame-focusable-content` rules (`src/core/a11y.ts`):
  a missing or generic `title` (`iframe`, `frame`, `untitled`, a URL or file name),
  the same `title` as another mounted `<Frame>` (compared trimmed and
  case-insensitively), and a negative `tabIndex`, which keeps keyboard users out of
  the rendered content. They run in an effect, so server rendering and StrictMode's
  extra render don't trigger them, and each fires once per `<Frame>`. `useIframe`
  doesn't check: its users render the `<iframe>` themselves.

`FrameContext` → `useFrame(): { window, document }`. This is required by CSS-in-JS
libraries (emotion `CacheProvider`, styled-components `StyleSheetManager target`)
and positioning libraries. Outside a `<Frame>`, `useFrame` returns the global
`window`/`document`, so the same component works in both places. On the server both
are `null`, and the types say so.

`copyStyles: true` clones `<style>` and `<link rel=stylesheet>` from the parent
`<head>` at mount. A `MutationObserver` then mirrors later additions, removals and
text changes, which covers dev HMR and runtime CSS-in-JS injection.
`adoptedStyleSheets` are copied by `cssText`. For CSS-in-JS, pointing the library at
`useFrame().document.head` is faster and exact, and the docs recommend it.

- Copies go at the start of the iframe `<head>`, in source order, so the iframe's own
  `head` content wins the cascade.
- Limits: only direct children of the parent `<head>` are copied. Rules added through
  CSSOM (`sheet.insertRule`, e.g. emotion's "speedy" production mode) are invisible to
  a `MutationObserver` and are not mirrored. `adoptedStyleSheets` are copied once, when
  mirroring starts (Safari < 16.4 has none, which is handled).

Nodes are copied with `importNode`, not rebuilt from text, which keeps
`integrity`/`crossorigin` on links. Each copy is also given the original's `nonce`
explicitly, which a strict host CSP needs: the srcdoc document inherits the host's
CSP, and a nonce-less inline `<style>` would be blocked. Cloning alone isn't enough.
Browsers hide a parsed nonce from the attribute, keeping it only in an internal slot.
Chromium and WebKit carry that slot over to a clone imported into another document;
Firefox doesn't, so there every copied style was blocked
(found by `e2e/csp.spec.ts`).

## Wire protocol (v1)

Every message is a plain object with a marker that doubles as the protocol version:

```ts
{ rik: 1, type: string, ... }
```

- Messages without `rik` are ignored silently, so the library coexists with any other
  postMessage traffic.
- Messages with any other `rik` value are ignored silently too. The handshake
  envelope is `rik: 1` forever (see [Versioning](#versioning)), so another value can
  only come from unrelated traffic that happens to use the same key.
- Every message is shape-validated (own properties, expected primitive types).
  Malformed messages are dropped silently: `debug` logging and devtools listeners see
  the messages that parse, which is what the protocol acted on.
- Unknown `type`s and unknown fields are ignored. This is what keeps additive
  protocol changes backward compatible.

### Handshake (over `window.postMessage`)

| type | direction | fields |
|---|---|---|
| `syn` | child → parent | `instance`, `versions` |
| `syn` | parent → child | `versions` (asks the child to announce itself) |
| `ack` | parent → child | `session`, `instance` (echoed), `version`, transfers `port2` |

Handshake messages always use the `rik: 1` envelope, even in future protocol
versions, so that any two releases can at least see each other.
`versions` lists the protocol versions the sender speaks (`[1]` today). The parent
picks the highest version both sides support, returns it as `version` in `ack`, and
all port traffic then uses that version. With no common version there is no `ack`,
and a dev warning names both lists.

```
child                                         parent
  | -- syn {instance, versions} --------------> |  targetOrigin '*' (carries no secrets)
  |                                             |  check: event.source === iframe.contentWindow
  |                                             |         event.origin === expected origin
  | <-- ack {session, instance, version}        |
  |         + [port2] ------------------------- |  targetOrigin = expected child origin
  | check: event.source === window.parent     |
  |        event.origin in allowedOrigins     |
  |        ack.instance === own instance      |
  | == ready (over port) ===================> |  connected on both sides
```

- **Both sides initiate.** This resolves the "who is listening first" race in both
  directions.
  - The child sends `syn` on start, in reply to a parent `syn` (after checking
    `event.source === window.parent`), and on `pageshow` with `persisted` (restore
    from the back/forward cache).
  - The parent sends `syn` only while it is `connecting`. It sends one **every time it
    enters `connecting`** (creation, `bye`, session loss) and on every iframe
    `load` while connecting. Its targetOrigin is `'*'`: the prompt carries nothing,
    and the page's `syn` it prompts is what gets checked (source and origin). It used to
    be the expected child origin, and then browsers logged "target origin does not
    match" on every page load, since the connection usually exists while the iframe
    still holds its initial `about:blank`. Skipping the prompt for that document would
    mean reading the iframe's `contentDocument`, which WebKit reports as an error once
    it's cross-origin. `e2e/host.spec.ts` fails on any console error on the host page.
    - The first rule closes a race. After a back/forward cache restore, the
      child's `bye` (on the port) and its new `syn` (on the window) travel through
      different queues, so the `syn` can arrive first. It is then ignored as a
      duplicate for a still-open session. When the `bye` is processed afterwards,
      the parent's own `syn` prompts the child again. Without this, nothing would
      ever restart the handshake: a restore fires no `load`.
- `instance` is a random id per child page load.
  - The parent ignores a `syn` from an instance that already has a pending or open
    session. Duplicate SYNs are expected.
  - A `syn` from a new instance means the child reloaded: the old session is
    closed (pending calls get `RIK_CONNECTION_LOST`) and a new one is started.
- `ack` echoes `instance`. The child ignores an `ack` for another instance: this is
  a stale ACK racing a reload.
- An `ack` from an origin that is not in `allowedOrigins` is dropped, and a dev
  warning names that origin. This is the most common integration mistake, and the
  parent cannot see it: it only observes a stalled handshake.
- `session` is a random id per parent connection. The child accepts an `ack` whose
  session differs from its current one (the parent reconnected, e.g. after a hook
  remount). It then closes the previous port and rejects that port's pending calls
  with `RIK_CONNECTION_LOST`.
- After `ack`, **all traffic goes over the private `MessagePort`**. There are no
  per-message origin checks and no interference with other scripts' `message`
  listeners. `MessagePort` delivery is ordered, so `ready` always arrives before
  the child's first `call`.
- **Liveness.** On `pagehide`, the child sends `bye` (best effort), closes its port
  and moves to `connecting`. The parent then rejects pending calls promptly
  instead of waiting for their timeout. If `bye` is lost, the loss is detected
  when a new instance sends `syn`, or by the per-call timeout.

### Port messages

| type | fields | meaning |
|---|---|---|
| `ready` | — | child → parent, handshake complete |
| `call` | `id`, `method`, `args` | RPC request |
| `result` | `id`, `ok: true`, `value` | RPC success |
| `result` | `id`, `ok: false`, `error: SerializedError` | RPC failure |
| `event` | `name`, `payload` | fire-and-forget event |
| `size` | `width`, `height`, `loop?` | child content size; `loop: true` when the child's feedback-loop guard is holding growth |
| `title` | `title` | child → parent with `syncTitle`: the child's trimmed `document.title` (see [Title](#title)) |
| `inert` | `inert` | parent → child from `useIframeInert`: whether the child should make itself inert (see [Inert](#inert)) |
| `bye` | — | the sending side is disposing or unloading |

`cancel` (`id`) is reserved for remote-side cancellation after v1.

`SerializedError = { name, message, code?, data?, stack? }`:

- `code` is included when the thrown value has a string or number `code`.
- `data` is included when the thrown value has an own `data` property that can be
  structured-cloned.
- `stack` is included **only when the responding side has `debug: true`**. Stacks leak
  file paths and internals to another origin.
- A thrown value that isn't an `Error` becomes `{ name: 'Error', message: String(value) }`.

Payloads are structured-clone only; functions are never sent.
`transfer(value, transferables)` returns a branded wrapper that is accepted as a call
argument, a method's return value, or an event payload. The wrapper is unwrapped and
its transferables are passed to `postMessage`.

If `postMessage` throws `DataCloneError`, the error is contained:

- on the caller side, the call rejects with `RIK_DATA_CLONE`;
- on the responding side, a return value that can't be cloned is sent back as an
  error result with `RIK_DATA_CLONE`.

- `emit` never throws, whether it sends immediately or at queue flush, where
  cloneability is only known then. An event whose payload can't be cloned is
  dropped with `console.error` (`RIK_DATA_CLONE`).

In all cases the connection stays open.

### Versioning

- `rik` is the **protocol** major version, independent of the npm version.
- Additive changes (new message types, new optional fields) do not bump it, because
  receivers ignore unknown types and fields.
- `rik` is bumped only for incompatible changes. A library release that speaks
  version N+1 also speaks N for at least one npm major. The version is negotiated in
  the handshake (`versions` / `version`, see above); the handshake envelope itself
  stays `rik: 1` forever.
- Any protocol change needs an update to this file and a compatibility test
  against the previously published `child` build.
- **Feature detection, when it's needed, is additive too.** If a later release has to
  know whether the other side supports something (a new port message, say), it adds an
  optional feature list to `syn`/`ack`. v1 receivers ignore the field, and its absence
  means "a release from before the list". That's why the list isn't added before it has
  a first user: it would be frozen with v1 without anything to describe.
  `protocol.test.ts` → "forward compatibility" pins what makes this safe: known messages
  with unknown fields still parse, and unknown port types are dropped.

## Connection sharing

Parent connections live in a `WeakMap<HTMLIFrameElement, Connection>` with reference
counting. Every hook on the same iframe shares one connection.

- Two users passing different `origin` values → `RIK_ORIGIN_CONFLICT`.
- `methods` from several `useIframeRPC` calls are merged. The same method name
  registered twice → `RIK_METHOD_CONFLICT`.
- Hooks acquire the connection and register `methods` and event handlers in a
  **layout effect**, not a passive one. Port messages are macrotasks and can run
  between a commit and its passive effects. Otherwise a `call` or `event` arriving
  right after connect could miss a method or handler from a component that was
  mounted in the same commit. `useLayoutEffect` is swapped for a no-op on the
  server.
- Releasing a user unregisters its `methods` and event handlers and rejects its
  pending and queued calls with `RIK_DESTROYED`.
  - `useIframeRPC` and `useParent` defer that release by **one macrotask**, like the
    transport below. StrictMode's simulated unmount/remount then reuses the same
    registration, so calls a mount effect just made are not rejected, and the
    remount never hits `RIK_METHOD_CONFLICT`. The hook's method wrappers switch off
    synchronously on unmount, so within that window its methods answer
    `RIK_METHOD_NOT_FOUND`: a method from an unmounted component is never called.
  - `useIframeEvent`/`useParentEvent` (handlers only, no calls to lose) and the
    imperative `handle.dispose()` release immediately.
- The transport teardown is **deferred by one macrotask** after the last user
  releases. A re-acquire inside that window reuses the open port, so StrictMode double
  mount/unmount causes no `bye` and no second handshake. Real disposal sends `bye`.

On the child side there is one page-level connection with the same rules:
reference counted, methods merged. Each `connectToParent` call returns a
**handle** bound to it. `handle.dispose()` releases only that caller's methods,
handlers and calls. The page connection itself stays open for the page's lifetime
(it sends `bye` on `pagehide`): closing it when the last handle goes would only
cost a new handshake the next time. Two
independent connections from one page would each send a `syn` with a different
`instance`, and the parent would read that as a reload loop. How options from
several callers combine:

- `allowedOrigins` must be equal as sets, otherwise `RIK_ORIGIN_CONFLICT`;
- `autoResize` is on if any caller enables it. Two different `measure` functions →
  `RIK_INVALID_OPTIONS`;
- `debug` is on if any caller enables it;
- `timeout` / `connectTimeout` are per caller and apply to that caller's calls.

The parent registry and the child singleton are shared across duplicate library
copies (see [Package layout](#package-layout)).

## RPC and events API

A contract describes one side: its methods and the events it emits.

```ts
// shared/contract.ts
import type { Side } from 'react-iframe-kit';

export type ParentSide = Side<{
  methods: { navigate(path: string): void; getUser(): User };
  events: { themeChanged: 'light' | 'dark'; closed: void };
}>;

export type ChildSide = Side<{
  methods: { setTheme(t: 'light' | 'dark'): void };
  events: { submitted: { id: string } };
}>;
```

Type rules:

- Generic order is always `<Remote, Local>`: the other side first.
- A remote method `(...args: A) => R` is exposed as `(...args: A) => Promise<Awaited<R>>`.
- An event with a `void` payload is emitted without an argument: `emit('closed')`.
- The method names `then` and `toJSON` are rejected at compile time by `Side<>`, and
  at runtime with `RIK_INVALID_OPTIONS`. `remote` hides both names (see below), so
  such methods could never be called.
- `Side<>` rejects function-typed arguments, return values and event payloads at
  compile time, since they would fail with `DataCloneError` at runtime.
  Some losses can't be expressed in types, and the docs spell them out: class
  instances arrive as plain objects without their prototype, and getters and
  symbol keys are dropped.

Hooks take `IframeTarget = HTMLIFrameElement | null | RefObject<HTMLIFrameElement | null>`.
A `RefObject` is resolved after every commit of the component that calls the hook,
so swapping the element reconnects. If the `<iframe>` is rendered by a different
component that can re-render on its own, pass the element instead (from state set
by a callback ref, or from `useIframe().iframe`). A `RefObject` would not notice
the swap.

Parent:

```ts
const { remote, emit, status, error } = useIframeRPC<ChildSide, ParentSide>(iframeRef, {
  origin: 'https://widget.example.com', // optional: defaults to the origin of iframe.src
  methods: { navigate, getUser },       // checked against ParentSide['methods']
  timeout: 10_000,                      // per call, from send to result; default 10s
  connectTimeout: 30_000,               // max wait of a queued call; default 30s
});
await remote.setTheme('dark');          // Promise<void>
emit('themeChanged', 'dark');
useIframeEvent<ChildSide, 'submitted'>(iframeRef, 'submitted', (p) => { /* p: { id: string } */ });
```

Child:

```ts
import { connectToParent } from 'react-iframe-kit/child';

const parent = connectToParent<ParentSide, ChildSide>({
  allowedOrigins: ['https://app.example.com'], // required
  methods: { setTheme },
  autoResize: true,
});
await parent.remote.getUser();
const off = parent.on('themeChanged', applyTheme);
parent.emit('submitted', { id });
await parent.whenConnected(); // resolves on the next `connected`; rejects RIK_DESTROYED on dispose
parent.status;   // same values as the parent side
parent.dispose();
```

Child with React: `useParent<Remote, Local>(options)` → `{ remote, emit, status, error }`
(backed by the page singleton; options are read on mount, except `methods`), and
`useParentEvent<Remote, Name>(name, handler)`.

The event hooks take the event name as a second type argument because TypeScript
can't infer one type argument while another is given explicitly. Without it, the
payload is typed as the union of all the side's payloads.

Besides `Side`, the contract types `Remote<S>` (the shape of `remote`),
`LocalMethods<S>` (any subset of a side's methods, sync or async), `Emit<S>`,
`On<S>` and `AnySide` (the default when no contract is given) are exported.
`Side<>`'s function check looks through plain objects, arrays and tuples up to 8
levels deep. Cloneable built-ins (`Date`, `RegExp`, `Map`, `Set`, `Blob`,
`ArrayBuffer`, typed arrays and so on) and `any` are accepted as they are.

### `remote`

`remote` is a shallow `Proxy`. A method map sent in `ready` can't be used instead,
because calls made before the connection exists must already work.

- The `get` trap returns a cached function per method name, so `remote.x` keeps the
  same identity across renders.
- `then`, `toJSON` and symbol keys return `undefined`. This keeps `remote` from being
  thenable, so `await` or `return remote` from an async function does not send a
  `call`. It also stays safe to log and serialize.

### Behaviour

- **Queueing.** Calls and events made while not connected are queued in order and
  flushed on connect.
  - This includes `useIframeRPC` while `idle`: no iframe element yet, e.g. one held
    in state from a callback ref, so a mount effect runs before it is set. Such
    calls wait in the hook (`src/core/deferredRpc.ts`), bounded by `connectTimeout`,
    and then join the connection's queue, where `connectTimeout` applies again to
    the handshake. The two waits are separate phases, so in that one case the total
    can reach twice `connectTimeout`.
  - A queued call that is still unsent after `connectTimeout` rejects with
    `RIK_TIMEOUT`. `connectTimeout: Infinity` is allowed.
  - The queue holds at most 1,000 messages. On overflow the new call rejects and a
    new event is dropped, both with `RIK_QUEUE_OVERFLOW` (the event case as a dev
    warning).
- **Timeout.** `timeout` runs from the moment the call is actually sent over the port.
  Time spent in the queue is bounded separately by `connectTimeout`, so a slow
  iframe load does not eat into the call's own timeout.
- `remote` and `emit` are referentially stable across renders.
- **Per-call options.** `withOptions(remote.method, { signal?, timeout? })` returns a
  function with the same signature. A per-call `timeout` is needed for methods that
  legitimately wait on a user, e.g. "open a dialog and resolve with the choice";
  `timeout: Infinity` is allowed.
  - Aborting before send removes the call from the queue.
  - Aborting after send rejects locally with `signal.reason` (a standard
    `AbortError` `DOMException`) and ignores the late result.
  - Remote-side cancellation is out of scope for v1 (`cancel` is reserved).
- **No parent.** If the child page is opened top-level (`window.parent === window`),
  `connectToParent` sends nothing and stays `idle`. Calls are queued and reject
  after `connectTimeout`, as with any unconnected call.
- **Events are not buffered on the receiving side.** An event that arrives while no
  handler is registered for its name is dropped.
- Several handlers may be registered for one event, and they run in registration
  order. A throwing handler is reported via `reportError` and does not stop the
  others.
- **Connection loss.** `bye`, a new child instance or a replaced session reject
  pending sent calls with `RIK_CONNECTION_LOST` and move the status back to
  `connecting`. New calls are queued for the next connection.
- **Dispose.** On unmount or `dispose()`, pending and queued calls reject with
  `RIK_DESTROYED`.
- **Incoming calls.** A method is found only if it is an own property that is a
  function (`Object.hasOwn(methods, name)`). Anything else, including
  `constructor`, `toString` and `__proto__`, results in `RIK_METHOD_NOT_FOUND`. The
  method is called with `this === undefined` and its result is awaited.
- Local `methods` and event handlers may change between renders. The latest ones
  are always used (through a ref), without reconnecting. The set of method *names*
  is taken when the hook registers (on mount, or when the iframe element changes);
  a name that later disappears from `methods` answers `RIK_METHOD_NOT_FOUND`.
- **Status** is `'idle' | 'connecting' | 'connected' | 'timeout' | 'error'`:
  - `idle`: no iframe element yet (parent), not framed, or running on the
    server (child);
  - `connecting`: waiting for the handshake, including after a connection loss;
  - `connected`: the handshake is complete;
  - `timeout`: still `connecting` after `connectTimeout`. A host needs this to show
    "the widget didn't load" without a timer of its own (Stripe Connect's `onLoadError`
    is the same idea). It is not terminal: the status moves on to `connected` if the
    handshake completes later, and a later connection loss starts a new wait. It
    reuses `connectTimeout` rather than adding an option: both mean "how long to wait
    for the connection". The timer is the hook's own (each hook has its own
    `connectTimeout`); the shared connection still only knows connecting/connected.
    - Parent: the wait starts when the status enters `connecting` and restarts on every
      iframe `load` while connecting, so a reloaded page gets its full time. For an
      iframe with `loading="lazy"` it starts only at `load`: off screen, the iframe
      hasn't started loading, and counting from mount would report a timeout for every
      widget below the fold. Queued calls still count `connectTimeout` from the call;
      the docs say to raise it for lazy iframes called early.
    - Child: `useParent` only. The imperative handle keeps `idle | connecting |
      connected` (its users have `whenConnected()` and their own timers), which keeps
      the `child` entries' budgets.
  - `error`: terminal configuration error. `error` holds the `IframeKitError`
    (`RIK_ORIGIN_CONFLICT`, `RIK_METHOD_CONFLICT` or `RIK_INVALID_OPTIONS`).
  
  A slow handshake is not an error. In dev, a connection still `connecting` after
  10 s logs a warning with the likely causes: child script not loaded, origin
  mismatch seen, `sandbox` flags. The warning lives in `useIframeRPC` and
  `useParent`, not in the connection: a same-origin `useIframeResize` never needs
  the handshake, and warning there would be noise.

## Validation

`Side<>` contracts are compile-time only, while everything that crosses the boundary is
untrusted input from another origin. `react-iframe-kit/validate` checks it at runtime with
any [Standard Schema](https://standardschema.dev) v1 library (the interface is copied, as
its spec asks, so there is no dependency):

```ts
methods: { prefill: validateArgs(z.tuple([Prefill]), (data) => apply(data)) }
on('orderCompleted', validatePayload(Order, track))
```

- **Wrappers, not options.** A `validate` option on the hooks and `connectToParent` would
  have put schema handling in the RPC engine and in every entry's budget (the `child`
  entry had 0.16 kB left). Wrapping a method or handler costs nothing to those who don't
  use it, works with every side and entry the same way, and keeps the protocol unchanged.
- `validateArgs` validates the arguments as a tuple and calls the method with the
  schema's output (transforms and defaults apply). Invalid arguments throw
  `RIK_VALIDATION` with `data: { message, path }[]` (paths as strings, so it clones), which
  the caller receives as a `RemoteError`.
- `validatePayload` drops an invalid event and reports the error with `reportError`, the
  same channel as a throwing handler. The handler runs a microtask later than
  unvalidated ones (schemas may be async).
- Covered by `src/core/validate.test.ts` and, end to end over the real protocol, in
  `src/core/connectToIframe.test.ts`.

## Resize

Parent:

```ts
const size = useIframeResize(iframeRef, { // { width, height } | null before the first measurement
  axis: 'height',   // 'height' | 'width' | 'both', default 'height'
  minHeight, maxHeight, minWidth, maxWidth,
  apply: true,      // false: only report, don't touch iframe styles
  onResize,         // (size) => void
  onResizeLoop,     // feedback-loop guard tripped (either side)
  origin,           // same meaning as in useIframeRPC; shares the connection
});
```

Child: `connectToParent({ autoResize: true | { measure } })`.

**The parent alone decides the axis.** The child always reports both `width` and
`height`, and the parent applies only what `axis` asks for. There is a single
source of truth, so the two sides can't disagree.

### Measurement

The child's `autoResize` and the parent's same-origin mode share one measurement
routine.

- **Height:** `Math.ceil(documentElement.getBoundingClientRect().height)`. This
  handles collapsing margins and is consistent across browsers, unlike
  `body.scrollHeight`.
  - When content really overflows the viewport (`scrollHeight > clientHeight`) and
    `scrollHeight` is larger than `<html>`'s box, e.g. with an
    `html, body { height: 100% }` reset or absolute/fixed content, `scrollHeight` is
    used and a dev warning is logged once. The size can then grow but not shrink below
    the current viewport.
  - `scrollHeight` is never used on its own: for `<html>` it never drops below the
    viewport, so an iframe sized by it could grow but never shrink.
- **Width:** `<html>` is always as wide as the viewport, so width can only be measured
  when the child's root shrink-wraps. `axis: 'width' | 'both'` on the parent
  requires `html { width: max-content }` (or `fit-content`) in the child. The
  measurement is marked as viewport-bound when the root does not shrink-wrap, and
  the parent then logs a dev warning. The same rect/`scrollWidth` rule applies.
- Values are rounded up, so a fractional size never produces a 1px scrollbar.
- `measure: (doc) => ({ width, height })` overrides measurement for exotic layouts.

Triggers:

- a `ResizeObserver` on `documentElement` and `body`;
- a `MutationObserver` (subtree, child list, attributes, character data);
- capture-phase `load` (images, iframes), `document.fonts` `loadingdone`,
  `transitionend` and `animationend`;
- connecting, which sends the initial size.

Triggers are batched to one measurement per animation frame. A 100 ms timer is the
fallback, because rAF is paused in hidden and `display: none` iframes. Unchanged
sizes are skipped.

A document that isn't rendered (an iframe that is `display: none` or inside a
hidden tab) measures as `0 × 0`. Such measurements are not reported. Otherwise the
parent would collapse the iframe, and it would flash back to full size when it
became visible.

### Applying (parent)

- The parent sets `iframe.style.height`/`width` in px, clamped to min/max.
  Border and padding are added when the iframe is `box-sizing: border-box`.
- With `apply: false` the hook only reports sizes.
- Changing `min*`/`max*`, `axis` or `apply` re-applies the last content size right
  away. Otherwise a new limit would only take effect on the next content change.
- **The connection caches the last `size` it received.** The child reports only on
  change, so a `useIframeResize` that mounts after the connection is up would
  otherwise wait for the next content change. The cached size is applied
  immediately on registration.
- `size` values must be finite and non-negative, otherwise the message is dropped.
  Everything else is trusted: the child decides its own size. For untrusted
  embeds, set `maxHeight`/`maxWidth`; a hostile child could otherwise grow to push
  host content around.
- In cross-origin mode, if the connection is up but no `size` has arrived 5 s after
  `useIframeResize` registered, a dev warning suggests enabling `autoResize` in
  the child.
- In same-origin mode, if the child also runs `autoResize`, the first `size` message
  for the current document switches off direct measurement for that document.
  The child opted in and knows its own layout.

### Feedback-loop guard

Content styled `height: 100vh` plus a margin or padding (or `100%` on a chain of
ancestors) grows with the iframe forever. The guard runs wherever the viewport is
known: in the child for `autoResize`, in the parent for same-origin mode.

- **Signature:** `content − viewport = c` for the same `c ≠ 0`, while the viewport
  has changed since the previous measurement. In other words, the content follows
  the viewport.
- **Trip:** after 30 consecutive matching measurements, growth freezes at the
  current size. A dev warning names the likely cause, and `onResizeLoop` fires on
  the parent. When the guard runs in the child, it reaches the parent through
  `size.loop`.
- The guard is tracked per axis.
- **Recovery:** the guard resumes automatically when the content changes, i.e. when
  `content − viewport` differs from the value it tripped on. A false positive, such as
  a long linear animation, therefore only pauses growth until the animation moves on.
  - "The pattern breaks" is not a usable recovery rule: while growth is held the
    viewport stops changing, so the pattern breaks on the very next measurement and
    the loop would continue in bursts of 30.
- Implementation: `src/core/loopGuard.ts`. Covered by e2e with a real `100vh + margin`
  page (must trip and stay still) and a 1.5 s linear accordion (must not trip).

## Title

Screen readers announce an iframe by its `title` (WCAG technique H64, axe-core
`frame-title`). A cross-origin parent can't read the page's own title, so the child
can send it, as iframe-resizer does:

```ts
// child
connectToParent({ allowedOrigins, syncTitle: true });
// parent
const title = useIframeTitle(iframeRef, { origin }); // string | undefined
<iframe ref={iframeRef} title={title ?? 'Checkout'} src={url} />;
```

- **Opt-in on the child.** A page title can hold private data (an inbox count, a
  user name), so nothing is sent without `syncTitle`.
- **The parent sets the attribute, through React.** The hook only returns the title;
  setting `iframe.title` itself would fight the `title` prop React owns. A fallback
  is needed anyway: the title arrives after the handshake, and older children or
  children without `syncTitle` never send one.
- The child sends `document.title`, trimmed, on connect (again to every new session)
  and on every change: a `MutationObserver` on `<head>` (child list, character data,
  subtree) catches both a new `<title>` element and new text in it. Unchanged titles
  are skipped.
- The parent connection caches the last title, like `size`, and forgets it when the
  session ends (`bye`, a reload, a new instance), since the next page may not send
  one. The hook returns `null` for an empty title (like `useIframeResize` before a
  size), and never a title from a previous iframe element.
- The title is trusted like `size`: it is text the child chose to describe itself,
  and it only ever reaches an attribute value.
- Same-origin iframes need the same `syncTitle` for now; reading their
  `contentDocument` directly would be possible but hasn't been needed.
- Protocol: `title` is an additive port message (see
  [Versioning](#versioning)): older parents ignore it, older children never send it.

## Inert

`useIframeInert(iframe, inert)` makes everything inside an iframe unclickable,
unfocusable and untypeable, e.g. behind a modal or in a read-only preview mode.

`inert` on the `<iframe>` element isn't enough. Measured with Playwright on
cross-origin and same-origin iframes: clicks and Tab are blocked in every engine, and
Firefox also takes focus out of the iframe. In Chromium and WebKit, though, keys keep
reaching an element that was focused inside before, and one the page focuses itself
afterwards. The page has to be made inert from the inside too:

- **`inert` on its `<body>`** stops it from focusing itself;
- **`blur()` on its active element** is needed on top in WebKit, where one key still
  reaches the element that had focus otherwise (`src/core/inert.ts`).

What the hook does while `inert` is true:

- sets the `inert` attribute on the `<iframe>` (and removes it after, unless it was
  there before: don't also pass `inert` as a prop);
- **same-origin** (e.g. `<Frame>`): makes the document inside inert directly, and again
  on every `load`, so no script is needed in the iframe;
- **cross-origin**: sends `inert` over the connection. Every `connectToParent` page
  handles it, with no option: the parent can already make the iframe inert from
  outside, so the page doing the same inside only makes that complete. The page undoes
  it when the session ends (`bye`, `pagehide`, a replaced session), so it can never
  stay inert without a parent asking. Several users of one iframe combine: it stays
  inert while any of them asks, and each new session is told on `ready`.
- The undo only clears `inert` where the library set it; a page whose own body was
  already inert keeps it.
- Not `iframe.blur()` in the parent: in WebKit it leaves the page's `activeElement`
  reading `body` while keys still reach the element that had focus, and the page's own
  blur then can't find that element.
- A child on an older version ignores the message and gets only the attribute: enough
  in Firefox, not in Chromium and WebKit.

Covered by `e2e/inert.spec.ts` in all three engines, for a cross-origin page and a
same-origin `<Frame>`: focus inside when it turns on, typing, clicking, Tab, the page
focusing itself, and everything working again once it's off.

### Focus traps (documented, not implemented)

An iframe inside a focus-trapped dialog can be unreachable by keyboard. Measured with
Playwright (Chromium, Firefox, WebKit) on a cross-origin iframe as the first or last
element of the dialog: focus-trap 8.2.2 skips it in every browser (its tabbable
selector doesn't match `<iframe>`; `tabIndex={0}` fixes Chromium and WebKit), Radix
`FocusScope` 1.1.16 fails in Firefox in one direction, and react-focus-lock 2.13.7
works everywhere. Focusable guards on both sides of the iframe fix every case, at the
cost of two extra Tab stops, which is noise where the library already works. So the
library doesn't add guards (no `<Frame trapSafe>`); the Accessibility guide on the docs
site has the table and a guard recipe, to apply only where a library needs it.

## Security

- **Parent expected origin:**
  - an explicit `origin`;
  - otherwise derived from the iframe's current `src` attribute on every handshake;
  - a `srcdoc` attribute (which takes precedence over `src`, as in the browser),
    `about:blank` or no `src` → the parent's own origin;
  - an iframe sandboxed without `allow-same-origin` is never auto-derived to
    `'null'`. The stalled-handshake warning points to `origin: 'null'` instead, so
    the opaque-origin risk stays an explicit opt-in.

  Every origin option is normalized with `new URL(value).origin`, so
  `https://Example.com/` equals `https://example.com`. A value with a path, query or
  hash, or one that is not a URL, is `RIK_INVALID_OPTIONS`. The only exception is
  the literal `'null'`.
  If the iframe navigates or redirects elsewhere, the handshake fails closed.
  `'*'` is `RIK_INVALID_OPTIONS` unless `unsafeAllowAnyOrigin: true` is set.
  `data:` and `javascript:` URLs have opaque origins, see below.
- **Child `allowedOrigins` is always required.** The child can't reliably learn its
  parent's origin: Firefox has no `location.ancestorOrigins`.
  - Entries are exact origin strings (normalized as above), `RegExp`s or predicates
    `(origin) => boolean`. An unanchored `RegExp` (without `^…$`) logs a dev warning.
  - A predicate is for multi-tenant embeds, whose allowed hosts come from
    configuration and change without a release. It is asked on every `ack`, so the
    answer can change while the page is open. Only a return value of exactly `true`
    allows: an async predicate returns a `Promise`, which is truthy and would
    otherwise allow every origin. For "same `allowedOrigins`" across callers (see
    [Connection sharing](#connection-sharing)), predicates compare by identity.
  - A `RegExp` with the `g` or `y` flag is `RIK_INVALID_OPTIONS`. With those flags,
    `test()` is stateful through `lastIndex`, so the same origin would be allowed
    and rejected on alternate calls.
  - `'*'` requires `unsafeAllowAnyOrigin: true`.
- Every message that establishes a session (child `syn` at the parent, `ack` at the
  child) is checked for `event.source` **and** `event.origin`. The `contentWindow`
  identity survives navigation, so a source check alone is not enough.
- The parent's `syn` is only a prompt and carries nothing, so the child checks only
  `event.source` before replying. Its reply is the same public `syn` it broadcasts
  anyway.
- **Opaque origins.** A child sandboxed without `allow-same-origin` has
  `event.origin === 'null'`. The parent has to opt in with `origin: 'null'`. Only
  `event.source` identifies the child in that case, and the `ack` must be posted
  with targetOrigin `'*'`. If the child document is replaced between `syn` and
  `ack`, the port could reach the new document. This risk is documented: don't
  expose privileged methods to opaque-origin children. On the child side, an
  opaque parent must be listed as `'null'` in `allowedOrigins`.
- Messages are shape-validated and malformed ones are dropped. Method lookup uses
  own properties only. Event handler registries are `Map`s, so an event named
  `__proto__` is just a name. There are no dynamic property paths and no `eval`.
- Error stacks cross the boundary only with `debug: true`.
- The docs include recommended `sandbox` and CSP settings (`frame-src` on the host,
  `frame-ancestors` on the child). They also note that `allow-scripts` +
  `allow-same-origin` on same-origin content is equivalent to no sandbox.

### Trusted Types

`srcdoc` is a `TrustedHTML` sink. On a host with `require-trusted-types-for 'script'`
(Chromium, Firefox and WebKit all enforce it now), assigning a plain string throws.
Rendering it as a React prop doesn't work either: React stringifies the value before
`setAttribute`, so even a `TrustedHTML` passed to `<iframe srcDoc>` is blocked, and
the throw during commit takes down the host app's whole tree (measured with React
19.3 in all three engines). Setting it outside React avoids depending on React's
Trusted Types handling in any version.

So `useIframe` sets `srcdoc` itself (`src/core/srcdoc.ts`):

- **Default document:** when the page has `trustedTypes`, it goes through a policy
  named **`react-iframe-kit`**. The policy creates exactly one document, the fixed
  marker document, which has nothing that can run script, and throws for any other
  input. It never passes caller HTML through, so allowing the name in a
  `trusted-types` directive can't be used to smuggle markup.
- **Custom `srcDoc`:** assigned as given. Under enforcement it must be a
  `TrustedHTML` from one of the host's policies (or pass the host's `default`
  policy). The library doesn't bless caller strings.
- **Blocked:** if the policy name is refused (a `trusted-types` directive without
  it), the default document is assigned as a string, which a host `default` policy
  may still accept. If the assignment throws, `useIframe` reports
  `RIK_INVALID_OPTIONS` (with the browser's error as `cause`) and `<Frame>` renders
  nothing into the iframe, per the [error policy](#error-policy). The message names
  the fix.
- A policy name can be created only once per page unless the directive says
  `'allow-duplicates'`, so library copies share the policy through the registry
  (`srcdocPolicies`, one per window's `trustedTypes` factory). A copy of a future
  protocol major would find no shared policy and fall back to the string; hosts that
  run two majors side by side need `'allow-duplicates'`.
- Content React renders into the iframe is not a sink, and neither is `copyStyles`
  (`importNode`). `dangerouslySetInnerHTML` inside the iframe is subject to the
  inherited policy as usual.

`e2e/trusted-types.spec.ts` covers all of this in the three engines.

## SSR

- Entries that use hooks start with `'use client'`.
- On the server, `<Frame>` renders a plain `<iframe>` without `srcdoc`, and nothing
  touches `document` until mounted. The `srcdoc` is set on the client, where it can
  go through a Trusted Types policy; it isn't needed earlier, since portaled content
  only appears after hydration anyway. The server-rendered iframe loads an
  `about:blank` before hydration, which the marker check (step 3 of the Firefox fix)
  never mistakes for the final document.
- The embedded page is often SSR'd too (Next.js etc.). Importing `react-iframe-kit/child`
  on the server must not touch `window`, and there is no top-level side effect. On
  the server `useParent` returns `status: 'idle'` and connects in an effect after
  hydration. `connectToParent` called on the server is a no-op that stays `idle`.
- Tests: a `renderToString` smoke test (no `srcdoc` in the markup), a hydration test
  in which the iframe loads before `hydrateRoot`, and a server render of a
  `useParent` component.

## Errors

All errors extend `IframeKitError` with a stable `code` and an optional `cause`.

| code | when |
|---|---|
| `RIK_TIMEOUT` | no result within `timeout` (`phase: 'response'`), or still queued after `connectTimeout` (`phase: 'connect'`) |
| `RIK_CONNECTION_LOST` | the peer sent `bye`, reloaded, or its session was replaced while the call was pending |
| `RIK_DESTROYED` | the local connection was disposed (unmount, `dispose()`) |
| `RIK_METHOD_NOT_FOUND` | the remote has no own function with that name |
| `RIK_REMOTE_ERROR` | the remote method threw; see `RemoteError` |
| `RIK_DATA_CLONE` | an argument, return value or payload could not be structured-cloned |
| `RIK_QUEUE_OVERFLOW` | more than 1,000 messages queued while not connected |
| `RIK_ORIGIN_CONFLICT` | two users of one iframe passed different origins |
| `RIK_METHOD_CONFLICT` | two users registered the same method name |
| `RIK_VALIDATION` | arguments or a payload failed a schema from `react-iframe-kit/validate` (see [Validation](#validation)) |
| `RIK_INVALID_OPTIONS` | e.g. `'*'` without `unsafeAllowAnyOrigin`, no `allowedOrigins` on the child, `<Frame>` in a sandbox without `allow-same-origin`, a `srcdoc` the host's Trusted Types policy blocks |

### Error policy

- **Hooks and components never throw for configuration or connection problems.** A
  throw during render would take down the host app's tree over an embed. Instead:
  - hooks move to `status: 'error'` with `error` set (`useIframe` exposes `error`);
  - `<Frame>` renders nothing into the iframe;
  - `console.error` is logged in every build.
- **Imperative APIs** (`connectToParent`, `transfer`, `withOptions`) throw
  synchronously on invalid options.
- **Calls** reject; they never throw synchronously.
- Behaviour is identical in dev and prod. Dev builds only add warnings; they never
  change control flow.

### `RemoteError`

`RemoteError` has `name === 'RemoteError'` and the remote `message`. Its `cause` holds
the `SerializedError`, so callers branch on `err.cause.name` / `err.cause.code`.

An abort rejects with `signal.reason` (a standard `AbortError`), not with an
`IframeKitError`.

Messages from an unexpected origin are not errors: they are dropped (logged with
`debug`), and the dev warning for a stalled handshake mentions them.

`debug: true` logs all protocol traffic to the console (`src/core/debugLog.ts`), each
message as a `console.debug` object. In the development build the line starts with a
summary: the type plus what identifies it (`call getUser #q9x7c1`, `event pinged`,
`size 320×480`, `result #q9x7c1 error RIK_TIMEOUT: …`, where `#…` is the call id's
random tail). A result also names the call it answers and its round-trip time, on
the caller's side, or the method's run time, on the side that ran it:
`(getUser, 12 ms)`. The production build logs the bare message, which keeps the
summaries out of its size budget.

## Testing

- **Vitest** (happy-dom): core protocol, handshake state machine, resize/loop-guard
  logic, with a hand-built fake window/iframe harness and **real** `MessageChannel`/
  `MessagePort` objects (mocking those specifically was not needed: Node/happy-dom's
  are spec-compliant, including their async, macrotask-based delivery — tests wait
  for it with `vi.waitFor` on the actual observable effect, not a fixed delay). RPC
  and events are covered here too: the engine (`rpc.ts`) on its own, and wired into
  both connections. The `Side<>` contract types have type-level tests
  (`contract.test.ts`, checked by `pnpm typecheck`: every `@ts-expect-error` must
  really be an error). Enforced at 100% statement/branch/function/line
  on `src/core` (`vitest.config.ts`); a handful of provably-unreachable branches
  (`__DEV__` guards under the test build's `define`, and one exhaustive union match)
  are marked with `v8 ignore` and explained inline rather than counted. `<Frame>`'s
  dev warnings are tested there too, with Testing Library (`Frame.test.tsx`).
- **Playwright** (chromium, firefox, webkit): real iframes, including cross-origin via
  two dev-server ports. Covered so far:
  - the #22847 document-replacement regression (`e2e/firefox-22847.spec.ts`);
  - cross-origin resize driven by the child's `autoResize`, including the parent
    applying exactly the reported height (`e2e/cross-origin-resize.spec.ts`);
  - an opaque-origin sandboxed child, both the `origin: 'null'` opt-in connecting
    and, without it, the handshake never completing (`e2e/sandboxed-child.spec.ts`).
    Its fixture only loads over ES modules because the e2e dev server uses them;
    `type="module"` fetches are CORS-checked even for an opaque request origin, so
    `e2e/vite.config.ts` sets `server.cors: true` — a dev-server-only concession to
    the fixture, not a product concern (a built child bundle isn't an ES module
    fetched cross-realm like this);
  - child reload/reconnect: a fresh `instance` after `location.reload()` is treated
    as a new session, not a stuck duplicate (`e2e/child-reload.spec.ts`);
  - the resize feedback-loop guard, including a long animated accordion that must
    not trip it;
  - `copyStyles` mirroring of styles injected at runtime;
  - the iframe loading before hydration;
  - a hidden iframe (`display: none`) does not collapse to 0;
  - RPC and events across origins with the React hooks on both sides
    (`e2e/rpc.spec.ts`): calls both ways, a `RemoteError` carrying the remote `code`,
    events both ways, a call made while `useIframeRPC` was still `idle`, the child
    calling the parent right after connect, and a per-call `timeout: Infinity`
    outliving a slow method that the default timeout rejects, and the child's
    `syncTitle` reaching `useIframeTitle`, including a later change. Both fixtures run in
    StrictMode and the spec fails on any page error; that is how the need for the
    deferred RPC release (see [Connection sharing](#connection-sharing)) showed up;
  - `copyStyles` under a host CSP of `style-src 'nonce-…'` (`e2e/csp.spec.ts`; the
    e2e dev server sends the header for that one fixture): copied styles keep their
    nonce, and a nonce-less style stays blocked both on the host and in the iframe;
  - `<Frame>` under Trusted Types (`e2e/trusted-types.spec.ts`, one CSP per case):
    rendering, `copyStyles` and resize with the policy allowed by default and by
    name; a refused policy and a blocked custom string reported as
    `RIK_INVALID_OPTIONS` while the host app keeps running; a custom `srcDoc` given
    as `TrustedHTML`.
  
  Covered by Vitest instead of Playwright, because the state machine is what's under
  test (not browser-specific behavior) and a real `MessageChannel` pair already
  proves the async wire semantics: StrictMode double mount (asserts a single
  handshake via the deferred-teardown timer), a stale `ack`/duplicate `syn` racing a
  reload, and bfcache restore (`pagehide`/`pageshow` semantics, simulated — a real
  back/forward navigation in Playwright is comparatively slow and flake-prone for
  what it would additionally prove).
  
  Two library copies on one page (`e2e/dual.spec.ts`): the built ESM and CJS
  copies, used crossed over, share one connection per iframe, the child connection,
  the frame context, the Trusted Types policy and error identity (`instanceof
  IframeKitError` across copies). It loads `dist/`, so CI builds before the e2e job;
  locally the spec skips, naming the reason, when the build is missing or older than
  `src`.
- **Version skew** (`e2e/skew.spec.ts`, CI job "Version skew", in all three engines): the parent from
  `main` against the last published `child` build, and vice versa. `pnpm skew:fetch`
  unpacks the latest published build into `e2e/.published`, after checking the
  registry's integrity hash (`SKEW_VERSION` picks another version, `SKEW_TARBALL` a
  local `pnpm pack` output). The same parent and child fixtures then run with the
  current sources on one side and that build on the other: handshake, resize, calls
  both ways, and an event. The spec reads what the build exports at runtime and
  skips whatever it predates, naming the reason. For `0.1.0` that is everything,
  since it has no protocol; the tests start running with the first release that
  ships one. Against a `pnpm pack` of the current build, both directions pass on all
  three browsers.
- React 18 and 19 matrix in CI: the unit suite on both, and the e2e suite on React 18
  in Chromium besides the three engines on 19. The React 18 e2e job found an update
  loop that the unit job couldn't: `useIframeTarget` scheduled a same-value update
  after every commit, and with several hooks in one StrictMode component React 18
  kept rendering (`src/react/useIframeTarget.test.tsx` now reproduces it in happy-dom).
- A `mobile-webkit` Playwright project (iPhone 15 viewport and touch input) runs the
  embed paths: handshake, cross-origin resize, calls, reloads, `<Frame>` and the
  sandboxed child.
- **Examples** (`examples/`, CI job "Example"): each example is installed as users get
  it, with the library replaced by a `pnpm pack` of the current build, and smoke-tested
  with Playwright: `examples/nextjs` after `next build` (server components importing
  the package, the `'use client'` boundaries, the handshake after hydration), and
  `examples/vanilla-widget` on two origins in all three engines.
- **Docs site** (`site/`, workflow "Docs"): a Playwright smoke test of the built site
  loads every page with no console errors, drives the live playground, and runs the
  RPC demo both ways.

## Devtools

`react-iframe-kit/devtools` shows the protocol traffic somewhere better than the
console.

```ts
import { connectReduxDevTools } from 'react-iframe-kit/devtools';

if (import.meta.env.DEV) connectReduxDevTools(); // returns the function that stops
```

- **`onProtocolMessage(listener)`** is the primitive: every message any connection
  sends or receives on the page, as `{ direction, message, detail? }`, whether or not
  `debug` is on. Listeners live in the registry, so they see every library copy's
  traffic, and the event shape is part of the cross-copy contract. `detail` (which
  call a result answers, and its timing) is filled in only where it's computed:
  development builds with `debug`.
- **`connectReduxDevTools({ name?, maxAge? })`** sends each message to the Redux
  DevTools extension as an action named by its summary (`→ call getUser #q9x7c1`),
  with the message as payload and `{ sent, received, last }` as state. That gives a
  searchable, filterable timeline with payload inspection for free, the way
  Zustand's `devtools` middleware reuses the extension. Without the extension, or on
  the server, it does nothing.
- On a page that is both a parent and a child, the listener sees both connections;
  `direction` is from that page's point of view.
- The summaries (`summarizeProtocolMessage`, shared with the dev-build `debug` log)
  live outside the connection code, so only the listener check reaches the main
  bundles.

## Testing utilities

`react-iframe-kit/testing` is for users' own tests of the parent side. In jsdom and
happy-dom an iframe has no real page, so a component using `useIframeRPC` and friends
never connects, and `postMessage` there is unreliable to mock by hand
(jestjs/jest#6765, jsdom/jsdom#2245).

```ts
render(<Checkout />);
const child = mockChild<ParentSide, ChildSide>(screen.getByTitle('Payment'), {
  methods: { pay: async (amount) => ({ ok: true }) },
});
await child.whenConnected();
child.resize({ width: 400, height: 300 });
child.setTitle('Payment');
child.emit('submitted', { id: '42' });
await child.remote.getUser();
child.dispose(); // like the page unloading: sends `bye`
```

- **The real protocol, not a stub.** `mockChild` plays the child's side of the
  handshake and runs the real `RpcEngine`, so the parent code under test goes through
  exactly what it does in a browser: origin checks, queueing, timeouts,
  `RemoteError`, `RIK_CONNECTION_LOST` on `bye`.
- **Over the iframe's own `contentWindow`.** Both environments give an attached
  iframe a window. `mockChild` replaces that window's `postMessage` with an own
  property, to receive the parent's syn prompts and `ack` (with its port), and
  dispatches its own `syn` on the parent `window` with `source: contentWindow`. jsdom
  rejects a `MessageEvent` whose `source` isn't a real window, which rules out a fake
  window object; `dispose()` restores `postMessage`.
- **Either order.** It sends a `syn` when created and answers the parent's prompt, so
  it can be created before or after the hooks mount.
- **Answers arrive in a later task**, like a real `postMessage`. The connections post
  their first `syn` from their constructors, before the caller's options are applied;
  a synchronous `ack` would be checked against an empty `allowedOrigins` and dropped.
- `origin` defaults to what the parent expects from the iframe's `src`.
- Needs a global `MessageChannel` (Node ≥ 15, and Vitest's jsdom and happy-dom
  environments). In happy-dom, an iframe with a remote `src` is fetched unless
  `navigation.disableChildFrameNavigation` is set; `disableIframePageLoading`
  instead leaves the iframe without a `contentWindow`, which `mockChild` needs.
- The same cases run in happy-dom (`src/testing/mockChild.test.tsx`) and jsdom
  (`mockChild.jsdom.test.tsx`).

`mockParent` is the other half, for testing `connectToParent`, `useParent` and
`useParentEvent`:

```ts
const parent = mockParent<ChildSide, ParentSide>({ methods: { getUser: () => user } });
render(<Widget />); // or connectToParent({ allowedOrigins, ... })
await parent.whenConnected();
await parent.remote.add(2, 3);
parent.emit('theme', 'dark');
parent.size; // { width, height } from autoResize; parent.title from syncTitle
parent.dispose(); // like the parent unmounting: sends `bye`, un-frames the page
```

- **It frames the page.** The child side only connects when `window.parent !==
  window`, so `mockParent` defines `window.parent` as the window of a hidden iframe of
  its own (a real window, for jsdom's `MessageEvent` check), intercepts that window's
  `postMessage` to receive the page's `syn`, and answers with an `ack` carrying a
  real `MessageChannel` port. `dispose()` restores `window.parent` and removes the
  iframe.
- **Create it first.** A page connection made while the page wasn't framed stays
  `'idle'` for good (it never listens). `mockParent` drops such a connection from the
  registry, so the next `connectToParent` starts a framed one; handles made before
  keep the idle one.
- **Across tests.** The page connection is a singleton for the whole test file. After
  a `dispose()` it goes back to `connecting`; the next `mockParent` prompts it with a
  `syn`, as a real parent does, and it reconnects.
- `origin` defaults to the test page's own origin; the page's `allowedOrigins` must
  accept it.
- `autoResize` needs layout that jsdom and happy-dom don't have: a 0 × 0 `<html>`
  counts as not rendered and is never reported, even with a custom `measure`, and
  jsdom has no `ResizeObserver`. Tests stub `documentElement.getBoundingClientRect`
  (and `ResizeObserver` in jsdom).
- The cases run in both environments (`mockParent.test.tsx`,
  `mockParent.jsdom.test.tsx`); the idle-connection case has its own file, since it
  needs a fresh registry.

## Docs site

`site/` is a Starlight (Astro) site, deployed to GitHub Pages by the "Docs" workflow
on every push to `main`. Starlight rather than VitePress because demos are React
islands, which Astro supports natively. The site has its own `package.json` and
lockfile, so the library's own CI jobs never install Astro. Its demos import the
library from `../src` (as the e2e fixtures do), so the site always shows `main`; a
note on the getting-started page says which features are not yet released.

- Guides: portal rendering, auto-resize, RPC and events, security (origins,
  `sandbox` flags, CSP on host and child).
- A live playground: edit HTML and CSS, rendered by `<Frame resize>`.
- A live RPC demo: a real parent/child pair on the site's origin.
- A comparison table with react-frame-component, iframe-resizer, Penpal and Comlink,
  hedged as the author's reading of their documented features.
- API and error reference.

## Tooling

TypeScript (strict) · tsdown (ESM + CJS + child IIFE, dts, publint + attw checks) ·
Vitest · Playwright · Biome (lint + format) · size-limit · changesets ·
GitHub Actions · `npm publish --provenance`. Package manager: pnpm.

Supply chain: workflow actions are pinned to commit SHAs (Dependabot updates the pins),
CodeQL and OpenSSF Scorecard run on `main`, the package has no runtime dependencies and
no install scripts, and releases go out through npm trusted publishing. The README's
"Stability, license and supply chain" section is the public version of this, with the
semver, deprecation and license commitments.

## Open questions

These can't be settled on paper and need to be resolved by a prototype before v1.

1. ~~**Does facebook/react#22847 still reproduce?**~~ Resolved 2026-09-27: yes in
   Firefox ≤ 146 (incl. ESR 140), fixed in 147/148; the same race exists in every
   browser once a `srcdoc` is used. See [Portal mode](#portal-mode-and-the-firefox-fix-facebookreact22847).
   Positioning: "mounts only into the final document", not "fixes a current Firefox bug".
2. ~~**Trusted Types.**~~ Resolved 2026-09-28: React stringifies `srcDoc`, so a host
   enforcing Trusted Types crashed on `<Frame>` in every engine. The fallback plan
   shipped: the hook sets `srcdoc` itself through a `react-iframe-kit` policy. See
   [Trusted Types](#trusted-types).
3. **Thresholds.** The 30-measurement loop guard and the 100 ms rAF fallback shipped
   in step 4 unchanged, and the resize-specific 5 s "no size arrived" warning shipped
   in step 5 unchanged; none have needed tuning yet. The 1,000-message queue and the
   10 s "still connecting" warning shipped in step 6 unchanged. Both are unit-tested
   but not yet checked against real-world usage.
4. ~~**Size budgets.**~~ Revised in steps 5 and 6 (see [Package layout](#package-layout)).
   Injecting the RPC engine keeps it out of resize-only parent bundles.

## Roadmap to v1

1. ~~Scaffold, CI, contributor hygiene.~~ Done: CI (lint, types, build, package, size,
   unit on React 18 and 19, e2e on three engines, version skew, docs site), release
   through changesets, CONTRIBUTING, SECURITY, CODE_OF_CONDUCT, issue and PR templates,
   Dependabot.
2. ~~Minimal Firefox #22847 repro on current React + Firefox.~~ Done: see
   [Portal mode](#portal-mode-and-the-firefox-fix-facebookreact22847).
3. ~~`useIframe` + `<Frame>` (+ `copyStyles`) + Playwright regression + SSR/hydration
   tests.~~ Done.
4. ~~Same-origin resize, including the feedback-loop guard.~~ Done: `useIframeResize`
   and `<Frame resize>` for same-origin iframes. The connection-related parts of
   [Applying](#applying-parent) (cached `size`, the missing-`autoResize` warning,
   `size.loop`) came with step 5, below.
5. ~~Core protocol + `child` entry (ESM + IIFE) + cross-origin resize.~~ Done:
   handshake (`src/core/parentConnection.ts`, `src/core/childConnection.ts`),
   `connectToParent`, `autoResize`, and `useIframeResize` now works cross-origin.
   `debug: true` protocol logging shipped too (`src/core/debugLog.ts`). See
   [Testing](#testing) for what's covered and what's deferred.
6. ~~RPC + events.~~ Done: `useIframeRPC`, `useIframeEvent`, `connectToParent`'s
   `remote`/`emit`/`on`/`whenConnected`, `useParent`/`useParentEvent`, `transfer`,
   `withOptions` and the `Side<>` contract types. RPC traffic is included in
   `debug: true` logging.
7. ~~Version-skew test harness; docs site (VitePress or Starlight) with live sandbox,
   comparison table, and security (sandbox/CSP) guide.~~ Done: see
   [Testing](#testing) (version skew) and [Docs site](#docs-site). The skew tests
   start running with the first release that ships the protocol. Along the way,
   `copyStyles` got its CSP test, which found and fixed the Firefox nonce issue
   described under [`<Frame>`](#frame).
8. **Before v1.** Everything above is built; what's left is freezing it.
   - ~~API consistency pass.~~ Done 2026-09-29: every parent hook takes the same
     connection options (`IframeConnectionOptions`: `origin`, `unsafeAllowAnyOrigin`,
     `debug`; before, only `useIframeRPC` had `debug`), and "nothing yet" is `null`
     everywhere (`useIframeTitle`, `mockParent.size`/`title`, as `useIframeResize` and
     `useIframe` already were). Both changed only APIs not yet released.
   - A 0.x release with everything since 0.2.0 (`useIframeTitle`, `useIframeInert`,
     `child/lite`, `testing`, `devtools`, the accessibility warnings), for real-world
     use before the API is frozen. The version-skew job then also tests it against
     0.2.0.
   - Settle the [thresholds](#open-questions) (open question 3) against that use.
   - Freeze for v1: the public API, wire protocol v1 and the registry's `/v1` shape
     (both already cross-version contracts, see [Versioning](#versioning) and
     [Package layout](#package-layout)).
9. **Production readiness** (2026-09-29, from a review of what white-label embeds and
   third-party iframes need). Done:
   - Fixes: `useIframeResize` warnings out of the production build (with a package
     check that fails on dev code there); an update loop with several hooks on one
     iframe under React 18; a "target origin does not match" console error on every
     embed; Safari security errors from reading cross-origin documents.
   - API, before the freeze: `status: 'timeout'`; predicates in `allowedOrigins`;
     `react-iframe-kit/host` (and its `<script>` build); `useIframeLoad`;
     `react-iframe-kit/validate`; the `sandbox` development warning.
   - Tests: e2e on React 18 and mobile WebKit, version skew in every engine, console
     errors fail the embed specs, forward-compatibility tests for the protocol, and the
     examples run in CI against the current build.
   - Trust and reach: SHA-pinned actions, CodeQL, OpenSSF Scorecard, Dependabot for the
     docs site, CDN snippets pinned with SRI on every release, a stability and license
     policy in the README, the embedding, third-party and migration guides, and
     `llms.txt`.

   Left, and not code: a second npm owner, GitHub Sponsors, and the launch (see the
   README's positioning). Deliberately left for demand: protocol primitives for host
   overlays, scrolling and route sync (recipes first, in the embedding guide), a popup
   transport, remote-side cancellation (`cancel` is reserved), adapters for other
   frameworks, and MCP Apps compatibility.

   Known issue: under heavy parallel load in Firefox, `e2e/rpc.spec.ts` occasionally
   loses the connection shortly after the handshake (about 1 in 80 runs, on `main`
   before this work too); CI's retries absorb it. Not yet reproduced in isolation.
