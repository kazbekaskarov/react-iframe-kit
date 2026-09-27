// The contract shared by e2e/fixtures/rpc-host.tsx and rpc-child.tsx.
import type { Side } from 'react-iframe-kit';

export type ParentSide = Side<{
  methods: { getUser(): { name: string }; wait(ms: number): Promise<string> };
  events: { themeChanged: 'light' | 'dark' };
}>;

export type ChildSide = Side<{
  methods: { add(a: number, b: number): number; echo(value: string): string; fail(): void };
  events: { submitted: { id: string } };
}>;
