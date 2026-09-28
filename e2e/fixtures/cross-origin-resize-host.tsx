// A plain, real cross-origin iframe (a separate dev server, not a portal), sized by
// the child's own `autoResize` report. `?lite` loads the child that uses
// `react-iframe-kit/child/lite`; the `call` button calls a method on it, which a lite
// child answers with RIK_METHOD_NOT_FOUND. See e2e/cross-origin-resize.spec.ts.
import { StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useIframeResize, useIframeRPC } from 'react-iframe-kit';
import { CHILD_ORIGIN } from '../origins';

const query = new URLSearchParams(location.search).has('lite') ? '?lite' : '';

function Host() {
  const ref = useRef<HTMLIFrameElement>(null);
  const size = useIframeResize(ref);
  const { remote } = useIframeRPC(ref);
  const [call, setCall] = useState('none');
  const probe = () => {
    remote['missing']?.().then(
      () => setCall('resolved'),
      (error: { code?: string; cause?: { code?: string } }) =>
        setCall(String(error.cause?.code ?? error.code)),
    );
  };
  return (
    <>
      <output data-testid="size">{size ? `${size.width}x${size.height}` : 'none'}</output>
      <output data-testid="call">{call}</output>
      <button type="button" onClick={probe}>
        call
      </button>
      <iframe
        ref={ref}
        title="frame"
        src={`${CHILD_ORIGIN}/cross-origin-resize-child.html${query}`}
      />
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
