# react-iframe-kit

[![npm](https://img.shields.io/npm/v/react-iframe-kit)](https://www.npmjs.com/package/react-iframe-kit)
[![CI](https://github.com/kazbekaskarov/react-iframe-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kazbekaskarov/react-iframe-kit/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/react-iframe-kit)](LICENSE)

**One hooks-first, TypeScript-first React library for iframes**: render React into an
iframe, size an iframe to its content, and talk to the page inside with typed calls and
events, all over one connection per iframe.

**[Docs, guides and live demos](https://kazbekaskarov.github.io/react-iframe-kit/)** ·
[Design and wire protocol](docs/design.md) ·
[Comparison with other libraries](https://kazbekaskarov.github.io/react-iframe-kit/comparison/)

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

The content mounts only into the iframe's final, standards-mode document, so it never
silently disappears when the document is replaced on load
([facebook/react#22847](https://github.com/facebook/react/issues/22847)).

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

No bundler on that page? One script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/react-iframe-kit/dist/child-lite.global.js"></script>
<script>
  ReactIframeKit.connectToParent({ allowedOrigins: ['https://app.example.com'], autoResize: true });
</script>
```

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

## Entry points

| Import | Use it in | Gives you |
|---|---|---|
| `react-iframe-kit` | the page that owns the `<iframe>` | `<Frame>`, `useFrame`, `useIframe`, `useIframeResize`, `useIframeRPC`, `useIframeEvent`, `useIframeTitle`, `useIframeInert` |
| `react-iframe-kit/child` | the page inside the iframe | `connectToParent`, with RPC and events |
| `react-iframe-kit/child/lite` | the page inside, when it only needs resize, title and inert | `connectToParent` without RPC |
| `react-iframe-kit/child/react` | the page inside, with React | `useParent`, `useParentEvent` |
| `react-iframe-kit/testing` | your tests | `mockChild`, `mockParent` |
| `react-iframe-kit/devtools` | development | `connectReduxDevTools`, `onProtocolMessage` |

## Size

Minified and gzipped, React excluded, enforced in CI. You pay only for what you import.

| What you import | Size |
|---|---|
| `useIframe` | 1.3 kB |
| `useIframeResize` | 5 kB |
| `<Frame>` with resize and `copyStyles` | 6.6 kB |
| `child/lite` (resize, title, inert) | 4.2 kB |
| `child` (with RPC and events) | 6.3 kB |

## Support

- React 18 and 19.
- The last two versions of Chrome, Edge and Firefox, and Safari 15.4+. Every change is
  tested in Chromium, Firefox and WebKit.

## Contributing

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md). Security issues:
[SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
