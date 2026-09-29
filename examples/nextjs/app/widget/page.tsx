// The page inside the iframe. A server component that renders the client-side widget;
// it works on its own too, when opened directly.
import type { Metadata } from 'next';
import { Widget } from './widget';

export const metadata: Metadata = { title: 'Tickets: choose your seats' };

export default function WidgetPage() {
  return <Widget />;
}
