import type { Side } from 'react-iframe-kit/host';

export type HostSide = Side<{
  methods: { getUser(id: number): { name: string } };
  events: { theme: string };
}>;

export type ChildSide = Side<{
  methods: { add(a: number, b: number): number };
  events: { submitted: { id: string } };
}>;
