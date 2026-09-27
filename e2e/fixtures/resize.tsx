// Same-origin resize scenarios, one per page load: ?case=<name>. See e2e/resize.spec.ts.
import { type ReactNode, StrictMode, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Frame, type UseIframeResizeOptions, useIframeResize } from 'react-iframe-kit';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');

// Reported to the test through a data attribute on #root.
const onResizeLoop: UseIframeResizeOptions['onResizeLoop'] = () => {
  root.dataset['loop'] = 'true';
};

function Lines() {
  const [count, setCount] = useState(3);
  return (
    <>
      <button type="button" onClick={() => setCount((n) => n + 10)}>
        more
      </button>
      <button type="button" onClick={() => setCount((n) => Math.max(1, n - 10))}>
        less
      </button>
      <Frame title="frame" resize={{ onResizeLoop }}>
        {Array.from({ length: count }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <p key={i}>line {i + 1}</p>
        ))}
      </Frame>
    </>
  );
}

// The limit changes while the content stays the same.
function MaxHeight() {
  const [maxHeight, setMaxHeight] = useState<number | undefined>(120);
  return (
    <>
      <button type="button" onClick={() => setMaxHeight(200)}>
        limit 200
      </button>
      <button type="button" onClick={() => setMaxHeight(undefined)}>
        no limit
      </button>
      <Frame title="frame" resize={{ maxHeight, minHeight: 40 }}>
        {Array.from({ length: 30 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static list
          <p key={i}>line {i + 1}</p>
        ))}
      </Frame>
    </>
  );
}

function BothAxes() {
  const [width, setWidth] = useState(200);
  return (
    <>
      <button type="button" onClick={() => setWidth((w) => w + 150)}>
        wider
      </button>
      <Frame
        title="frame"
        resize={{ axis: 'both' }}
        head={<style>{'html { width: max-content; } body { margin: 0; }'}</style>}
      >
        <div style={{ width, height: 80, background: 'teal' }} />
      </Frame>
    </>
  );
}

function Accordion() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)}>
        toggle
      </button>
      <Frame title="frame" resize={{ onResizeLoop }}>
        <div
          data-testid="panel"
          style={{ height: open ? 900 : 20, transition: 'height 1.5s linear', background: 'tan' }}
        />
      </Frame>
    </>
  );
}

function ViewportLoop() {
  return (
    <Frame title="frame" resize={{ onResizeLoop }}>
      <div style={{ height: '100vh', marginBottom: 10, background: 'salmon' }} />
    </Frame>
  );
}

function Hidden() {
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setVisible((v) => !v)}>
        visibility
      </button>
      <div style={{ display: visible ? 'block' : 'none' }}>
        <Frame title="frame" resize>
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static list
            <p key={i}>line {i + 1}</p>
          ))}
        </Frame>
      </div>
    </>
  );
}

// The hook on a plain same-origin iframe with `src`, through a RefObject.
function PlainIframe({ apply }: { apply: boolean }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const size = useIframeResize(ref, { apply });
  return (
    <>
      <output data-testid="size">{size ? `${size.width}x${size.height}` : 'none'}</output>
      <iframe ref={ref} title="frame" src="/resize-page.html" />
    </>
  );
}

const cases: Record<string, () => ReactNode> = {
  lines: () => <Lines />,
  'max-height': () => <MaxHeight />,
  'both-axes': () => <BothAxes />,
  accordion: () => <Accordion />,
  'viewport-loop': () => <ViewportLoop />,
  hidden: () => <Hidden />,
  'plain-iframe': () => <PlainIframe apply />,
  'report-only': () => <PlainIframe apply={false} />,
};

const name = new URLSearchParams(location.search).get('case') ?? '';
const Case = cases[name];
if (!Case) throw new Error(`unknown case "${name}"`);
createRoot(root).render(
  <StrictMode>
    <Case />
  </StrictMode>,
);
