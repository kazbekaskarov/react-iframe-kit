// Parent side of a real cross-origin RPC connection. The iframe element is held in
// state (set from a callback ref), so the mount effect below calls `remote.echo`
// while the hook is still idle: that call must wait and still succeed.
// See e2e/rpc.spec.ts.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { RemoteError, useIframeEvent, useIframeRPC, useIframeTitle } from 'react-iframe-kit';
import { connectReduxDevTools } from 'react-iframe-kit/devtools';
import { CHILD_ORIGIN } from '../origins';
import type { ChildSide, ParentSide } from './rpc-contract';

function Host() {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [early, setEarly] = useState('pending');
  const [result, setResult] = useState('none');
  const [submitted, setSubmitted] = useState('none');

  const { remote, emit, status } = useIframeRPC<ChildSide, ParentSide>(iframe, {
    methods: {
      getUser: () => ({ name: 'ann' }),
      wait: (ms) => new Promise((resolve) => setTimeout(() => resolve('done'), ms)),
    },
  });
  useIframeEvent<ChildSide, 'submitted'>(iframe, 'submitted', (payload) =>
    setSubmitted(payload.id),
  );
  // Shown rather than set as the iframe's `title`, which the spec locates it by.
  const childTitle = useIframeTitle(iframe);

  useEffect(() => {
    remote.echo('early').then(setEarly, (error: unknown) => setEarly(String(error)));
  }, [remote]);

  const fail = () =>
    remote.fail().catch((error: unknown) => {
      const cause = (error as RemoteError).cause as { code?: string };
      setResult(error instanceof RemoteError ? `RemoteError:${cause.code}` : String(error));
    });

  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="early">{early}</output>
      <output data-testid="result">{result}</output>
      <output data-testid="submitted">{submitted}</output>
      <output data-testid="child-title">{childTitle ?? 'none'}</output>
      <button type="button" onClick={() => remote.add(2, 3).then((sum) => setResult(String(sum)))}>
        add
      </button>
      <button type="button" onClick={fail}>
        fail
      </button>
      <button type="button" onClick={() => emit('themeChanged', 'dark')}>
        dark
      </button>
      <iframe ref={setIframe} title="frame" src={`${CHILD_ORIGIN}/rpc-child.html`} />
    </>
  );
}

// A no-op unless the spec installed a fake Redux DevTools extension first.
connectReduxDevTools({ name: 'rpc-host' });

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
