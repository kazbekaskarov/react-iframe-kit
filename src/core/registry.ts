/**
 * Page-wide state shared by every copy of the library with the same protocol major
 * (duplicate bundles, ESM + CJS). See docs/design.md → Package layout.
 *
 * The key and the shape of this object are a cross-copy contract: fields may be
 * added, never changed or removed. An incompatible change needs a new key (`/v2`).
 */
export interface Registry {
  /** React context for `<Frame>` / `useFrame`, created by the first copy that needs it. */
  frameContext?: unknown;
  /** One `ParentConnectionImpl` per iframe element. See core/parentConnection.ts. */
  parentConnections?: WeakMap<HTMLIFrameElement, unknown>;
  /** The page's single `ChildConnectionImpl`, if this page has ever called `connectToParent`. */
  childConnection?: unknown;
  /** Generated once per page load, reused by every `connectToParent` caller. */
  childInstance?: string;
  /**
   * The "react-iframe-kit" Trusted Types policy per window's factory, or `null` if the
   * page refused it. The policy accepts only the v1 default srcdoc; a different default
   * document needs a new field. See core/srcdoc.ts.
   */
  srcdocPolicies?: WeakMap<object, unknown>;
}

const KEY: unique symbol = Symbol.for('react-iframe-kit/v1');

export function getRegistry(): Registry {
  const scope = globalThis as { [KEY]?: Registry };
  scope[KEY] ??= {};
  return scope[KEY];
}
