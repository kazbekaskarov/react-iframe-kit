// A plain, real cross-origin iframe (a separate dev server, not a portal), sized by
// the child's own `autoResize` report. See e2e/cross-origin-resize.spec.ts.
import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useIframeResize } from 'react-iframe-kit';
import { CHILD_ORIGIN } from '../origins';

function Host() {
  const ref = useRef<HTMLIFrameElement>(null);
  const size = useIframeResize(ref);
  return (
    <>
      <output data-testid="size">{size ? `${size.width}x${size.height}` : 'none'}</output>
      <iframe ref={ref} title="frame" src={`${CHILD_ORIGIN}/cross-origin-resize-child.html`} />
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
