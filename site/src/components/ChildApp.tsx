// Child half of the RPC demo, served as its own page (/demo/child/). It only accepts
// a parent on the site's own origin.
import { useRef, useState } from 'react';
import { useParent } from 'react-iframe-kit/child/react';
import type { DemoChild, DemoParent } from './demo-contract';

export default function ChildApp() {
  const [color, setColor] = useState('#ffffff');
  const [lines, setLines] = useState<string[]>([]);
  const clicks = useRef(0);

  const { remote, emit, status } = useParent<DemoParent, DemoChild>({
    allowedOrigins: [window.location.origin],
    autoResize: true,
    methods: {
      setColor: (next) => setColor(next),
      getClicks: () => clicks.current,
    },
  });

  const click = () => {
    clicks.current += 1;
    emit('clicked', { count: clicks.current });
  };
  const askTime = async () => {
    const time = await remote.now();
    setLines((all) => [...all, `parent says ${time}`]);
  };

  return (
    <main style={{ background: color, padding: 16, font: '15px/1.5 system-ui, sans-serif' }}>
      <p style={{ margin: '0 0 8px' }}>
        I'm the child page (status: <code>{status}</code>).
      </p>
      <button type="button" onClick={click}>
        emit('clicked')
      </button>{' '}
      <button type="button" onClick={askTime}>
        remote.now()
      </button>
      {lines.map((line, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: an append-only list
        <p key={index} style={{ margin: '4px 0' }}>
          {line}
        </p>
      ))}
    </main>
  );
}
