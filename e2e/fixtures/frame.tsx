// `<Frame>` scenarios, one per page load: ?case=<name>. See e2e/frame.spec.ts.
import { type ReactNode, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Frame, useFrame } from 'react-iframe-kit';

function Probe() {
  const frame = useFrame();
  const [clicks, setClicks] = useState(0);
  return (
    <div
      data-testid="probe"
      data-realm={frame.document === window.parent.document ? 'parent' : 'iframe'}
    >
      <p className="copied">styled</p>
      <button type="button" onClick={() => setClicks((n) => n + 1)}>
        clicked {clicks}
      </button>
    </div>
  );
}

const cases: Record<string, () => ReactNode> = {
  basic: () => (
    <Frame title="frame">
      <Probe />
    </Frame>
  ),
  head: () => (
    <Frame title="frame" head={<style>{'.copied { color: rgb(0, 128, 0); }'}</style>}>
      <Probe />
    </Frame>
  ),
  'copy-styles': () => (
    <Frame title="frame" copyStyles>
      <Probe />
    </Frame>
  ),
  'custom-srcdoc': () => (
    <Frame title="frame" srcDoc="<!DOCTYPE html><html><body><h1>custom</h1></body></html>">
      <Probe />
    </Frame>
  ),
  sandbox: () => (
    <Frame title="frame" sandbox="allow-scripts">
      <Probe />
    </Frame>
  ),
};

const name = new URLSearchParams(location.search).get('case') ?? '';
const Case = cases[name];
const root = document.getElementById('root');
if (!root || !Case) throw new Error(`unknown case "${name}"`);
createRoot(root).render(
  <StrictMode>
    <Case />
  </StrictMode>,
);
