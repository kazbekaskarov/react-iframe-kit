// Parent half of the RPC demo: calls the child page's methods, answers its calls, and
// listens to its events, all over the real handshake and MessagePort.
import { useState } from 'react';
import { useIframeEvent, useIframeResize, useIframeRPC } from 'react-iframe-kit';
import { childUrl, type DemoChild, type DemoParent } from './demo-contract';

const COLORS = ['#fde68a', '#bbf7d0', '#bfdbfe', '#fecaca', '#e9d5ff'];

export default function RpcDemo() {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((lines) => [line, ...lines].slice(0, 8));

  const { remote, status } = useIframeRPC<DemoChild, DemoParent>(iframe, {
    methods: {
      now: () => {
        const time = new Date().toLocaleTimeString();
        add(`child called now() → ${time}`);
        return time;
      },
    },
  });
  useIframeResize(iframe);
  useIframeEvent<DemoChild, 'clicked'>(iframe, 'clicked', ({ count }) =>
    add(`event clicked { count: ${count} }`),
  );

  const paint = async () => {
    const color = COLORS[Math.floor(Math.random() * COLORS.length)] ?? COLORS[0];
    await remote.setColor(color as string);
    add(`setColor('${color}') resolved`);
  };
  const clicks = async () => add(`getClicks() → ${await remote.getClicks()}`);

  return (
    <div className="not-content" style={{ display: 'grid', gap: '0.75rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span>
          status: <code>{status}</code>
        </span>
        <button type="button" onClick={paint}>
          remote.setColor()
        </button>
        <button type="button" onClick={clicks}>
          remote.getClicks()
        </button>
      </div>
      <iframe
        ref={setIframe}
        title="RPC demo child"
        src={childUrl()}
        style={{ width: '100%', border: '1px solid var(--sl-color-gray-5, #ccc)' }}
      />
      <ol style={{ margin: 0, fontFamily: 'var(--sl-font-mono, monospace)', fontSize: '0.85rem' }}>
        {log.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: an append-only log
          <li key={index}>{line}</li>
        ))}
      </ol>
    </div>
  );
}
