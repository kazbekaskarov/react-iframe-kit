// Child side of a real cross-origin RPC connection, through the React child entry.
// Its mount effect calls the parent immediately: queued until the handshake
// completes, then answered by methods the parent registered. See e2e/rpc.spec.ts.
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { withOptions } from 'react-iframe-kit/child';
import { useParent, useParentEvent } from 'react-iframe-kit/child/react';
import type { ChildSide, ParentSide } from './rpc-contract';

function Child() {
  const [user, setUser] = useState('pending');
  const [theme, setTheme] = useState('light');
  const [slow, setSlow] = useState('pending');
  const [unbounded, setUnbounded] = useState('pending');

  const { remote, emit, status } = useParent<ParentSide, ChildSide>({
    allowedOrigins: [/^http:\/\/127\.0\.0\.1:\d+$/],
    timeout: 500,
    syncTitle: true,
    methods: {
      add: (a, b) => a + b,
      echo: (value) => value,
      fail: () => {
        throw Object.assign(new Error('nope'), { code: 'E_NOPE' });
      },
    },
  });
  useParentEvent<ParentSide, 'themeChanged'>('themeChanged', setTheme);

  useEffect(() => {
    remote.getUser().then((u) => setUser(u.name));
    // 1.5 s against a 500 ms default timeout: must time out...
    remote.wait(1500).then(setSlow, (error: { code?: string }) => setSlow(String(error.code)));
    // ...unless this one call opts out of the timeout.
    withOptions(remote.wait, { timeout: Number.POSITIVE_INFINITY })(1500).then(setUnbounded);
  }, [remote]);

  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="user">{user}</output>
      <output data-testid="theme">{theme}</output>
      <output data-testid="slow">{slow}</output>
      <output data-testid="unbounded">{unbounded}</output>
      <button type="button" onClick={() => emit('submitted', { id: '42' })}>
        submit
      </button>
      <button
        type="button"
        onClick={() => {
          document.title = 'Renamed child';
        }}
      >
        rename
      </button>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Child />
  </StrictMode>,
);
