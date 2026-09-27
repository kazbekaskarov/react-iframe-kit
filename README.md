# react-iframe-kit

> **Status: pre-release, not ready for use.** The API is being designed and built in the
> open; the `0.0.0` version on npm only reserves the name. See
> [docs/design.md](docs/design.md) for the full design.

One TypeScript-first, hooks-first React library for everything you do with iframes:

| You need to… | Today you'd use | react-iframe-kit |
|---|---|---|
| Render React children into an iframe | react-frame-component | `<Frame>`, `useIframe` |
| Size the iframe to its content | iframe-resizer | `useIframeResize`, `<Frame resize>` |
| Talk to the iframe with typed calls and events | Penpal, Comlink | `useIframeRPC`, `connectToParent` |

All three share one connection per iframe.

## Why another iframe library

- **Content never vanishes on load.** Portaling into an iframe from a ref callback
  silently loses the content when the iframe's document is replaced after mounting:
  in Firefox up to 146, including ESR 140
  ([facebook/react#22847](https://github.com/facebook/react/issues/22847)), and in
  every browser once the iframe has a `srcdoc`. react-iframe-kit mounts only into the
  final document, in standards mode.
- **Typed both ways.** One contract type describes each side's methods and events;
  calls return promises with the right types.
- **Secure by default.** Explicit origins on both sides, a private `MessageChannel` after
  the handshake, no stack traces leaking across origins.
- **Built for real deployments.** Host and embedded page can run different versions of
  the library; the protocol is versioned separately from the package.

## Planned API

```tsx
// Parent
const { remote, status } = useIframeRPC<ChildSide, ParentSide>(iframeRef, {
  origin: 'https://widget.example.com',
  methods: { getUser },
});
await remote.setTheme('dark');

// Child (inside the iframe)
import { connectToParent } from 'react-iframe-kit/child';

const parent = connectToParent<ParentSide, ChildSide>({
  allowedOrigins: ['https://app.example.com'],
  methods: { setTheme },
  autoResize: true,
});
```

## Contributing

Contributions are welcome — see [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[MIT](LICENSE)
