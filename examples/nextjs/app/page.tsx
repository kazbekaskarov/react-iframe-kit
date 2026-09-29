// A server component: the host page. Only the part that talks to the iframe is a
// client component (react-iframe-kit's hooks entry is marked 'use client').
import { TicketWidget } from './ticket-widget';

export default function Page() {
  return (
    <main style={{ maxWidth: 720, margin: '2rem auto', padding: '0 1rem' }}>
      <h1>Concert tickets</h1>
      <p>The widget below is an iframe that sizes itself and talks to this page.</p>
      <TicketWidget />
    </main>
  );
}
