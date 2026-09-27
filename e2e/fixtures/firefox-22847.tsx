// Reproduction of facebook/react#22847: content portaled into an iframe disappears in
// Firefox because the initial about:blank document is replaced on `load`.
// One variant per page load: ?variant=<name>. See docs/design.md → Portal mode.
// `no-src` / `about-blank` reproduce the original bug only in Firefox ≤ 146; the e2e
// tests use the `srcdoc-*` variants, which replace the document in every browser.
import { type ReactNode, StrictMode, useState } from 'react';
import { createPortal } from 'react-dom';
import { createRoot } from 'react-dom/client';

const SRCDOC = '<!DOCTYPE html><html><head></head><body data-rik-root></body></html>';

const content = <p data-testid="portal-content">portaled</p>;

function Portal({ into, children }: { into: HTMLElement | null; children: ReactNode }) {
  return into ? createPortal(children, into) : null;
}

// The naive pattern from the issue: take the body in the ref callback, portal at once.
function Naive(props: { src?: string; srcDoc?: string }) {
  const [body, setBody] = useState<HTMLElement | null>(null);
  return (
    <>
      <iframe
        title="frame"
        {...props}
        ref={(iframe) => setBody(iframe?.contentDocument?.body ?? null)}
      />
      <Portal into={body}>{content}</Portal>
    </>
  );
}

// The fix from docs/design.md: srcdoc + mount only after the native `load` of the
// final document (listener attached natively in the ref callback).
function SrcdocAfterLoad() {
  const [body, setBody] = useState<HTMLElement | null>(null);
  return (
    <>
      <iframe
        title="frame"
        srcDoc={SRCDOC}
        ref={(iframe) => {
          if (!iframe) return;
          const mount = () => {
            const doc = iframe.contentDocument;
            if (doc?.body?.hasAttribute('data-rik-root')) setBody(doc.body);
          };
          mount();
          iframe.addEventListener('load', mount);
          return () => iframe.removeEventListener('load', mount);
        }}
      />
      <Portal into={body}>{content}</Portal>
    </>
  );
}

const variants: Record<string, () => ReactNode> = {
  'no-src': () => <Naive />,
  'about-blank': () => <Naive src="about:blank" />,
  'srcdoc-naive': () => <Naive srcDoc={SRCDOC} />,
  'srcdoc-load': () => <SrcdocAfterLoad />,
};

const name = new URLSearchParams(location.search).get('variant') ?? '';
const Variant = variants[name];
const root = document.getElementById('root');
if (!root || !Variant) throw new Error(`unknown variant "${name}"`);
createRoot(root).render(
  <StrictMode>
    <Variant />
  </StrictMode>,
);
