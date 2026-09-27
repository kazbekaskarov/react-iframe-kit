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
}

const KEY: unique symbol = Symbol.for('react-iframe-kit/v1');

export function getRegistry(): Registry {
  const scope = globalThis as { [KEY]?: Registry };
  scope[KEY] ??= {};
  return scope[KEY];
}
