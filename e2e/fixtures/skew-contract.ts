// Version-skew fixtures (e2e/skew.spec.ts): the same parent and child logic, run
// against either the current sources or a published build. Only the module passed in
// differs, so a failure points at the protocol, not at the fixtures.
import type * as ParentKit from 'react-iframe-kit';
import type * as ChildKit from 'react-iframe-kit/child';

export type ParentSide = ParentKit.Side<{
  methods: { getName(): string };
}>;

export type ChildSide = ParentKit.Side<{
  methods: { add(a: number, b: number): number };
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is how contracts spell "no payload"
  events: { pinged: void };
}>;

export type ParentModule = typeof ParentKit;
export type ChildModule = typeof ChildKit;
