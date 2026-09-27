// Parent half of the version-skew pair. See skew-contract.ts.
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { ChildSide, ParentModule, ParentSide } from './skew-contract';

function Host({ kit, childUrl }: { kit: ParentModule; childUrl: string }) {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [sum, setSum] = useState('none');
  const [pings, setPings] = useState(0);

  const size = kit.useIframeResize(iframe);
  const { remote, status } = kit.useIframeRPC<ChildSide, ParentSide>(iframe, {
    methods: { getName: () => 'parent' },
  });
  kit.useIframeEvent<ChildSide, 'pinged'>(iframe, 'pinged', () => setPings((n) => n + 1));

  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="size">{size ? String(size.height) : 'none'}</output>
      <output data-testid="sum">{sum}</output>
      <output data-testid="pings">{pings}</output>
      <button type="button" onClick={() => remote.add(2, 3).then((n) => setSum(String(n)))}>
        add
      </button>
      <iframe ref={setIframe} title="frame" src={childUrl} />
    </>
  );
}

export function renderHost(kit: ParentModule, childUrl: string): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('#root is missing');
  createRoot(root).render(
    <StrictMode>
      <Host kit={kit} childUrl={childUrl} />
    </StrictMode>,
  );
}
