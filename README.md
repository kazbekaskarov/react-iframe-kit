# react-iframe-kit

[![npm](https://img.shields.io/npm/v/react-iframe-kit)](https://www.npmjs.com/package/react-iframe-kit)
[![CI](https://github.com/kazbekaskarov/react-iframe-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kazbekaskarov/react-iframe-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-iframe-kit)](LICENSE)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/kazbekaskarov/react-iframe-kit/badge)](https://scorecard.dev/viewer/?uri=github.com/kazbekaskarov/react-iframe-kit)

**One hooks-first, TypeScript-first React library for iframes**: render React into an
iframe, size an iframe to its content, and talk to the page inside with typed calls and
events, all over one connection per iframe.

**[Docs, guides and live demos](https://kazbekaskarov.github.io/react-iframe-kit/)** ·
[Design and wire protocol](docs/design.md) ·
[Comparison with other libraries](https://kazbekaskarov.github.io/react-iframe-kit/comparison/) ·
[Migrate from iframe-resizer](https://kazbekaskarov.github.io/react-iframe-kit/guides/migrate-from-iframe-resizer/)

> **Pre-1.0.** The API can still change before 1.0; breaking changes are called out in
> the [changelog](CHANGELOG.md).

| You need to… | Usually | Here |
|---|---|---|
| Render React children into an iframe | react-frame-component | `<Frame>`, `useIframe` |
| Size an iframe to its content, same- or cross-origin | iframe-resizer | `useIframeResize`, `<Frame resize>` |
| Call methods and send events across the boundary, typed | Penpal, Comlink | `useIframeRPC`, `useIframeEvent`, `connectToParent` |

## Install

```sh
npm install react-iframe-kit
```

React 18 or 19 is a peer dependency; the page inside the iframe doesn't need React.

## Render React into an iframe

When you own the content, render it straight into a same-origin iframe. Its CSS and
layout stay isolated from the host page.

```tsx
import { Frame } from 'react-iframe-kit';

<Frame title="Invoice preview" resize copyStyles>
  <Invoice data={invoice} />
</Frame>;
```

The content mounts only after the iframe's own standards-mode document has loaded, and
remounts after every reload.

## Size a cross-origin iframe to its content

The page inside reports its size, the parent applies it:

```tsx
// parent
import { useIframeResize } from 'react-iframe-kit';

const ref = useRef<HTMLIFrameElement>(null);
useIframeResize(ref, { maxHeight: 2000 });
return <iframe ref={ref} title="Widget" src="https://widget.example.com/" />;
```

```ts
// the page inside, https://widget.example.com
import { connectToParent } from 'react-iframe-kit/child/lite';

connectToParent({ allowedOrigins: ['https://app.example.com'], autoResize: true });
```

No bundler on that page? One script tag, pinned to a version with its integrity hash:

```html
<script src="https://cdn.jsdelivr.net/npm/react-iframe-kit@0.3.0/dist/child-lite.global.js" integrity="sha384-qfKxbj3iMvr1XizMH3VaSAK70Jggp/PocCrNLa5NxALDWILYOOJzkrtjcMHeOahl" crossorigin="anonymous"></script>
<script>
  ReactIframeKit.connectToParent({ allowedOrigins: ['https://app.example.com'], autoResize: true });
</script>
```

The host page doesn't need React either. A widget embedded on customers' sites, or a
page moving off iframe-resizer, uses `react-iframe-kit/host` (also a `<script>` build,
global `ReactIframeKitHost`):

```ts
// the host page, https://app.example.com
import { connectToIframe } from 'react-iframe-kit/host';

connectToIframe(document.querySelector('iframe'), { resize: true, syncTitle: true });
```

[Embedding a widget](https://kazbekaskarov.github.io/react-iframe-kit/guides/embedding/)
covers the white-label case end to end: loader script, multi-tenant origins, theming,
tokens, analytics events, payments and cookies.

## Call methods across the boundary

Describe each side once, and both ends are typed:

```ts
// shared/contract.ts
import type { Side } from 'react-iframe-kit';

export type ParentSide = Side<{ methods: { getUser(): { name: string } } }>;
export type ChildSide = Side<{
  methods: { setTheme(theme: 'light' | 'dark'): void };
  events: { submitted: { id: string } };
}>;
```

```tsx
// parent
const { remote, status } = useIframeRPC<ChildSide, ParentSide>(ref, {
  methods: { getUser: () => currentUser },
});
useIframeEvent<ChildSide, 'submitted'>(ref, 'submitted', ({ id }) => open(id));
await remote.setTheme('dark');
```

```ts
// the page inside
import { connectToParent } from 'react-iframe-kit/child';

const parent = connectToParent<ParentSide, ChildSide>({
  allowedOrigins: ['https://app.example.com'],
  methods: { setTheme },
});
const user = await parent.remote.getUser();
```

Calls made before the connection is up are queued; each call has a timeout; errors
thrown on the other side arrive as `RemoteError` with their `code`. Resize and RPC on
the same iframe share one handshake.

## Also included

- **Accessibility.** `<Frame>` warns in development about a missing or duplicate
  `title` and a negative `tabIndex`. `useIframeTitle` gives a cross-origin iframe the
  title of the page inside it, and `useIframeInert` makes an iframe truly inert
  (the `inert` attribute alone still lets keys through in Chromium and Safari). The
  [Accessibility guide](https://kazbekaskarov.github.io/react-iframe-kit/guides/accessibility/)
  also covers iframes inside focus-trapped dialogs.
- **Security by default.** Explicit origins on both sides, a private `MessageChannel`
  after the handshake, no stack traces across origins, and support for pages that
  enforce Trusted Types or a nonce-based CSP.
  [Security guide](https://kazbekaskarov.github.io/react-iframe-kit/guides/security/).
- **Testing.** `react-iframe-kit/testing` has `mockChild` and `mockParent`, which play
  the other side over the real protocol in jsdom or happy-dom.
- **Devtools.** `debug: true` logs every message with a readable summary;
  `react-iframe-kit/devtools` sends them to the Redux DevTools extension.
- **Independent deploys.** The host and the embedded page may run different versions of
  the library: the wire protocol is versioned separately, and CI tests `main` against
  the last published release both ways. Several copies of the library on one page share
  one connection.
- **SSR-safe**, React Server Components-friendly (`'use client'` only where hooks are),
  ESM and CJS.

## Examples

Runnable, and tested in CI against every change:

- [`examples/nextjs`](examples/nextjs): a Next.js App Router host and widget, with calls,
  events, resize, title and a fallback when the widget doesn't load.
  [Open in StackBlitz](https://stackblitz.com/github/kazbekaskarov/react-iframe-kit/tree/main/examples/nextjs).
- [`examples/vanilla-widget`](examples/vanilla-widget): a white-label ticket widget on a
  site without React: the customer's snippet, the vendor's loader with a command queue,
  and the widget, on two origins.

## Entry points

| Import | Use it in | Gives you |
|---|---|---|
| `react-iframe-kit` | the page that owns the `<iframe>` | `<Frame>`, `useFrame`, `useIframe`, `useIframeResize`, `useIframeRPC`, `useIframeEvent`, `useIframeTitle`, `useIframeInert`, `useIframeLoad` |
| `react-iframe-kit/child` | the page inside the iframe | `connectToParent`, with RPC and events |
| `react-iframe-kit/child/lite` | the page inside, when it only needs resize, title and inert | `connectToParent` without RPC |
| `react-iframe-kit/child/react` | the page inside, with React | `useParent`, `useParentEvent` |
| `react-iframe-kit/host` | the page that owns the `<iframe>`, without React | `connectToIframe`: resize, RPC, events, title, inert |
| `react-iframe-kit/validate` | either side | `validateArgs`, `validatePayload`: runtime checks with Zod, Valibot or any Standard Schema library |
| `react-iframe-kit/testing` | your tests | `mockChild`, `mockParent` |
| `react-iframe-kit/devtools` | development | `connectReduxDevTools`, `onProtocolMessage` |

## Size

Minified and gzipped, React excluded, enforced in CI. You pay only for what you import.

| What you import | Size |
|---|---|
| `useIframe` | 1.3 kB |
| `useIframeResize` | 4.5 kB |
| `<Frame>` with resize and `copyStyles` | 6.1 kB |
| `child/lite` (resize, title, inert) | 4.2 kB |
| `child` (with RPC and events) | 6.4 kB |
| `host` (`connectToIframe`, without React) | 6 kB |
| `validate` | 0.7 kB |

## Support

- React 18 and 19.
- The last two versions of Chrome, Edge and Firefox, and Safari 15.4+. Every change is
  tested in Chromium, Firefox, WebKit and mobile WebKit, on React 18 and 19, and against
  the last published release.

## Stability, license and supply chain

- **MIT, and it stays MIT.** No relicensing, no paid tier for features, including
  cross-origin resize. Past releases can't be taken back, and future ones won't change
  the license.
- **Semantic versioning.** Until 1.0, minor releases may change the API, and the
  [changelog](CHANGELOG.md) says how to update. From 1.0: breaking changes only in a
  major release; a deprecated API keeps working, with a development warning, for at
  least one minor release before it's removed.
- **Wire protocol compatibility.** A host and an embedded page on different releases keep
  working together: a release that speaks a new protocol version also speaks the previous
  one for at least one major release, and CI tests every change against the last
  published release, in both directions. The protocol is also a public contract:
  [Integrate without the library](https://kazbekaskarov.github.io/react-iframe-kit/guides/without-the-library/)
  documents it for hosts that don't use the library, and CI runs the hand-written host
  from that page against the widget in every engine.
- **Supply chain.** No runtime dependencies and no install scripts. Releases are
  published from CI with npm trusted publishing, with
  [provenance](https://docs.npmjs.com/generating-provenance-statements) linking each
  tarball to the commit and workflow that built it. Workflow actions are pinned to
  commit SHAs; CodeQL and OpenSSF Scorecard run on every change to `main`.
- **Security fixes** are acknowledged within 72 hours; see [SECURITY.md](SECURITY.md).

## For AI assistants

[`llms.txt`](https://kazbekaskarov.github.io/react-iframe-kit/llms.txt) sums up the entry
points, the rules code using the library has to follow, and links to every guide.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
