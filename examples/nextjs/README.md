# react-iframe-kit with Next.js (App Router)

A host page and an embedded ticket widget in one Next.js app:

- `app/page.tsx` is a server component; `app/ticket-widget.tsx` is the client component
  that owns the `<iframe>`: `useIframeRPC`, `useIframeResize`, `useIframeEvent`,
  `useIframeTitle`, and a fallback link when the widget doesn't connect
  (`status === 'timeout'`).
- `app/widget/` is the page inside the iframe: `useParent` with `autoResize` and
  `syncTitle`, a method the host calls (`prefill`), and an event it sends
  (`orderCompleted`).
- `app/contract.ts` types both sides.

Here both pages come from the same app. In a real embed they are usually on different
origins: list the host's origin in the widget's `allowedOrigins`, and the host derives the
widget's from its `src`.

```sh
npm install
npm run dev
```

[Open in StackBlitz](https://stackblitz.com/github/kazbekaskarov/react-iframe-kit/tree/main/examples/nextjs)
