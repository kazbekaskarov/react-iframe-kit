// Child entry: `react-iframe-kit/child`. Must not depend on React.
// See docs/design.md → Package layout.

export type { ChildStatus } from '../core/childConnection';
export type { ConnectToParentOptions, ParentHandle } from '../core/connectToParent';
export { connectToParent } from '../core/connectToParent';
export type {
  AnySide,
  Contract,
  Emit,
  EventHandler,
  LocalMethods,
  On,
  Remote,
  Side,
  SideShape,
} from '../core/contract';
export type { ErrorCode, SerializedError, TimeoutPhase } from '../core/errors';
export { IframeKitError, isIframeKitError, RemoteError, TimeoutError } from '../core/errors';
export type { MeasureFn, Size } from '../core/measure';
export type { OriginMatcher } from '../core/origin';
export type { CallOptions } from '../core/remote';
export { withOptions } from '../core/remote';
export { transfer } from '../core/transfer';
