// The contract between RpcDemo (parent) and ChildApp (the page at /demo/child/).
import type { Side } from 'react-iframe-kit';

export type DemoParent = Side<{
  methods: { now(): string };
}>;

export type DemoChild = Side<{
  methods: { setColor(color: string): void; getClicks(): number };
  events: { clicked: { count: number } };
}>;

export function childUrl(): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/demo/child/`;
}
