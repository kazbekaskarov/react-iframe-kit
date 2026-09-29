'use client';

import { useRef, useState } from 'react';
import { useIframeEvent, useIframeResize, useIframeRPC, useIframeTitle } from 'react-iframe-kit';
import type { HostSide, WidgetSide } from './contract';

export function TicketWidget() {
  const ref = useRef<HTMLIFrameElement>(null);
  const [orders, setOrders] = useState<string[]>([]);

  const { remote, emit, status } = useIframeRPC<WidgetSide, HostSide>(ref, {
    methods: { getToken: () => `token-${Date.now()}` },
    connectTimeout: 10_000,
  });
  useIframeResize(ref, { maxHeight: 2000 });
  useIframeEvent<WidgetSide, 'orderCompleted'>(ref, 'orderCompleted', ({ orderId, tickets }) =>
    setOrders((previous) => [...previous, `${orderId} (${tickets})`]),
  );
  const title = useIframeTitle(ref);

  if (status === 'timeout') {
    return <a href="/widget">The widget didn't load. Open it on its own page.</a>;
  }

  return (
    <section>
      <p>
        Status: <output data-testid="status">{status}</output>
      </p>
      <p>
        <button type="button" onClick={() => remote.prefill('ann@example.com')}>
          Prefill email
        </button>{' '}
        <button type="button" onClick={() => emit('themeChanged', 'dark')}>
          Dark theme
        </button>
      </p>
      <iframe
        ref={ref}
        src="/widget"
        title={title ?? 'Tickets'}
        style={{ width: '100%', border: '1px solid #ccc', borderRadius: 8 }}
      />
      <p>
        Orders: <output data-testid="orders">{orders.join(', ') || 'none'}</output>
      </p>
    </section>
  );
}
