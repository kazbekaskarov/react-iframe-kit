// Two copies of the built library on one page (e2e/dual.spec.ts): the ESM build as
// `kit-esm` and the CJS build as `kit-cjs` (served as ESM by e2e/vite.config.ts).
import type * as ParentKit from 'react-iframe-kit';
import type * as ChildKit from 'react-iframe-kit/child';

export type ParentSide = ParentKit.Side<{
  methods: { getName(): string };
}>;

// `add` is registered by the child's CJS copy, `multiply` and `fail` by its ESM copy.
export type ChildSide = ParentKit.Side<{
  methods: {
    add(a: number, b: number): number;
    multiply(a: number, b: number): number;
    fail(): void;
  };
  // biome-ignore lint/suspicious/noConfusingVoidType: `void` is how contracts spell "no payload"
  events: { pinged: void };
}>;

export type ParentModule = typeof ParentKit;
export type ChildModule = typeof ChildKit;
