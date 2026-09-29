'use client';

import { useState } from 'react';
import { useParent, useParentEvent } from 'react-iframe-kit/child/react';
import type { HostSide, Theme, WidgetSide } from '../contract';

// In a real white-label widget this list comes from the tenant's configuration; here
// the host is this same app. A predicate is asked on every handshake, and only runs in
// the browser.
const allowedOrigins = [(origin: string) => origin === window.location.origin];

export function Widget() {
  const [email, setEmail] = useState('');
  const [tickets, setTickets] = useState(1);
  const [theme, setTheme] = useState<Theme>('light');

  const { remote, emit, status } = useParent<HostSide, WidgetSide>({
    allowedOrigins,
    autoResize: true,
    syncTitle: true,
    methods: {
      prefill: (value) => {
        setEmail(value);
        return true;
      },
    },
  });
  useParentEvent<HostSide, 'themeChanged'>('themeChanged', setTheme);

  const dark = theme === 'dark';
  return (
    <form
      style={{
        padding: 16,
        background: dark ? '#111' : '#fff',
        color: dark ? '#eee' : '#111',
      }}
      onSubmit={async (event) => {
        event.preventDefault();
        await remote.getToken(); // e.g. to authorize the order with your API
        emit('orderCompleted', { orderId: `A-${Date.now() % 10_000}`, tickets });
      }}
    >
      <p>
        Connection: <output data-testid="widget-status">{status}</output>
      </p>
      <label>
        Email <input value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <p>
        <label>
          Tickets{' '}
          <input
            type="number"
            min={1}
            max={10}
            value={tickets}
            onChange={(e) => setTickets(Number(e.target.value))}
          />
        </label>
      </p>
      <button type="submit">Buy</button>
    </form>
  );
}
