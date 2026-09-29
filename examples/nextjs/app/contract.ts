// The contract both pages share: what each side offers the other. Types only, so it
// can be imported from server and client components alike.
import type { Side } from 'react-iframe-kit';

export type Theme = 'light' | 'dark';

export type HostSide = Side<{
  methods: { getToken(): string };
  events: { themeChanged: Theme };
}>;

export type WidgetSide = Side<{
  methods: { prefill(email: string): boolean };
  events: { orderCompleted: { orderId: string; tickets: number } };
}>;
