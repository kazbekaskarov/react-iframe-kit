// `useIframeLoad` on iframes whose pages don't run this library: one that loads, one far
// below the fold with `loading="lazy"`, and one that never finishes (a server that
// doesn't answer). See e2e/third-party.spec.ts.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useIframeLoad } from 'react-iframe-kit';
import { CHILD_ORIGIN } from '../origins';

function Embed({ name, src, lazy }: { name: string; src: string; lazy?: boolean }) {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const status = useIframeLoad(iframe, { timeout: 1_000 });
  return (
    <section>
      <output data-testid={name}>{status}</output>
      <iframe ref={setIframe} title={name} src={src} loading={lazy ? 'lazy' : undefined} />
    </section>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Embed name="loads" src={`${CHILD_ORIGIN}/third-party-page.html`} />
    <Embed name="hangs" src={`${CHILD_ORIGIN}/__hang`} />
    <div style={{ height: '10000px' }} />
    <Embed name="lazy" src={`${CHILD_ORIGIN}/__hang`} lazy />
  </StrictMode>,
);
