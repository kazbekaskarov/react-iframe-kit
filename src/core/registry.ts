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
  /**
   * Called with every protocol message any copy sends or receives on this page (see
   * core/debugLog.ts). The event shape is part of the cross-copy contract.
   */
  protocolListeners?: Set<ProtocolListener>;
}

/** A protocol message as `onProtocolMessage` listeners see it. */
export interface ProtocolEvent {
  /** `→` sent by this page, `←` received by it. */
  direction: '→' | '←';
  /** The message as it went over the wire (a plain object with `rik` and `type`). */
  message: { rik: number; type: string };
  /** What only the logging side knows, e.g. `getUser, 12 ms` on a result. Dev and `debug` only. */
  detail?: string | undefined;
}

export type ProtocolListener = (event: ProtocolEvent) => void;

const KEY: unique symbol = Symbol.for('react-iframe-kit/v1');

export function getRegistry(): Registry {
  const scope = globalThis as { [KEY]?: Registry };
  scope[KEY] ??= {};
  return scope[KEY];
}
