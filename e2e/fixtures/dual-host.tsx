// Parent half of e2e/dual.spec.ts: every feature is used through both library
// copies at once, crossed over so that nothing works unless the copies share state.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChildSide, ParentModule, ParentSide } from './dual-contract';

/** Which of `kit`'s error checks accept `error`. */
function checks(error: unknown, kit: ParentModule): string {
  return [
    error instanceof kit.IframeKitError && 'IframeKitError',
    error instanceof kit.RemoteError && 'RemoteError',
    error instanceof kit.TimeoutError && 'TimeoutError',
    kit.isIframeKitError(error) && 'isIframeKitError',
  ]
    .filter(Boolean)
    .join(' ');
}

/** Rendered by one copy's `<Frame>`, reading the frame through the other copy's `useFrame`. */
function FrameProbe({ kit }: { kit: ParentModule }) {
  const { document } = kit.useFrame();
  return (
    <p data-testid="probe">
      {document?.body.hasAttribute('data-rik-root') ? 'inside the frame' : 'no frame'}
    </p>
  );
}

function Host({ esm, cjs, childUrl }: { esm: ParentModule; cjs: ParentModule; childUrl: string }) {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [results, setResults] = useState('none');
  const [remoteError, setRemoteError] = useState('none');
  const [crossed, setCrossed] = useState('none');
  const [pings, setPings] = useState(0);

  // One iframe, three hooks from two copies: they must share one connection.
  const size = esm.useIframeResize(iframe);
  const viaCjs = cjs.useIframeRPC<ChildSide, ParentSide>(iframe, {
    methods: { getName: () => 'parent' },
  });
  const viaEsm = esm.useIframeRPC<ChildSide>(iframe);
  esm.useIframeEvent<ChildSide, 'pinged'>(iframe, 'pinged', () => setPings((n) => n + 1));

  const call = async () => {
    const [sum, product] = await Promise.all([
      viaCjs.remote.add(2, 3),
      viaEsm.remote.multiply(2, 3),
    ]);
    setResults(`${sum} ${product}`);
  };
  // The error is created by the copy that owns the shared connection, whichever hook
  // made the call; it's checked with the other copy's classes.
  const fail = async () => {
    try {
      await viaEsm.remote.fail();
      setRemoteError('resolved');
    } catch (error) {
      const owner = Object.getPrototypeOf(error);
      const [name, other] =
        owner === esm.RemoteError.prototype
          ? ['esm', cjs]
          : owner === cjs.RemoteError.prototype
            ? ['cjs', esm]
            : ['unknown', esm];
      setRemoteError(`from ${name}, other copy: ${checks(error, other)}`);
    }
    // Both directions, with a subclass that stands for another code.
    setCrossed(
      [
        checks(new esm.TimeoutError('response', 'late'), cjs),
        checks(new cjs.RemoteError({ name: 'Error', message: 'nope' }), esm),
      ].join(' | '),
    );
  };

  return (
    <>
      <output data-testid="status">{`${viaCjs.status} ${viaEsm.status}`}</output>
      <output data-testid="size">{size ? String(size.height) : 'none'}</output>
      <output data-testid="results">{results}</output>
      <output data-testid="remote-error">{remoteError}</output>
      <output data-testid="crossed">{crossed}</output>
      <output data-testid="pings">{pings}</output>
      <button type="button" onClick={call}>
        call
      </button>
      <button type="button" onClick={fail}>
        fail
      </button>
      <esm.Frame title="esm-frame">
        <FrameProbe kit={cjs} />
      </esm.Frame>
      <cjs.Frame title="cjs-frame">
        <FrameProbe kit={esm} />
      </cjs.Frame>
      <iframe ref={setIframe} title="child" src={childUrl} />
    </>
  );
}

export function renderHost(esm: ParentModule, cjs: ParentModule, childUrl: string): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root is missing');
  createRoot(root).render(
    <StrictMode>
      <Host esm={esm} cjs={cjs} childUrl={childUrl} />
    </StrictMode>,
  );
}
