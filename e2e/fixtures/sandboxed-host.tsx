// Same-origin `src`, but `sandbox="allow-scripts"` (no `allow-same-origin`) makes the
// child's actual runtime origin opaque ("null"), same as a real 3rd-party sandboxed
// widget. `origin: 'null'` is the explicit opt-in this requires.
// See e2e/sandboxed-child.spec.ts and docs/design.md → Security → Opaque origins.
import { StrictMode, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { useIframeResize } from 'react-iframe-kit';

// ?origin=null opts into the opaque child; omitting it proves opacity is never
// auto-derived (the handshake then never completes).
const explicitOrigin = new URLSearchParams(location.search).get('origin') === 'null';

function Host() {
  const ref = useRef<HTMLIFrameElement>(null);
  const size = useIframeResize(ref, explicitOrigin ? { origin: 'null' } : {});
  return (
    <>
      <output data-testid="size">{size ? `${size.width}x${size.height}` : 'none'}</output>
      <iframe ref={ref} title="frame" src="/sandboxed-child.html" sandbox="allow-scripts" />
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
