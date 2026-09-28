// useIframeInert on a cross-origin iframe whose page runs `connectToParent`
// (`?mode=cross`), or on a same-origin <Frame> with no script inside (`?mode=frame`).
// The spec toggles it through `window.setInert`, so that focus can stay inside the
// iframe while it changes. See e2e/inert.spec.ts.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Frame, useIframeInert } from 'react-iframe-kit';
import { CHILD_ORIGIN } from '../origins';

const mode = new URLSearchParams(location.search).get('mode');

function FrameContent() {
  const [clicks, setClicks] = useState(0);
  return (
    <>
      <input id="inner" aria-label="inner" />
      <button id="button" type="button" onClick={() => setClicks((n) => n + 1)}>
        button
      </button>
      <output id="clicks">{clicks}</output>
    </>
  );
}

function Host() {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [inert, setInert] = useState(false);
  useIframeInert(iframe, inert);
  useEffect(() => {
    Object.assign(window, { setInert });
  }, []);

  return (
    <>
      <output data-testid="inert">{String(inert)}</output>
      {mode === 'frame' ? (
        <Frame ref={setIframe} title="embed" style={{ width: 300, height: 150 }}>
          <FrameContent />
        </Frame>
      ) : (
        <iframe
          ref={setIframe}
          title="embed"
          src={`${CHILD_ORIGIN}/inert-child.html`}
          style={{ width: 300, height: 150 }}
        />
      )}
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
