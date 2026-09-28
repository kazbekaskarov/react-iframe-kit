// Lite child entry: `react-iframe-kit/child/lite`. `connectToParent` without RPC and
// events, for pages that only need `autoResize`, `syncTitle` and inert, and not the
// RPC engine's weight. Must not depend on React. See docs/design.md → Package layout.

export type {
  ChildStatus,
  LiteConnectToParentOptions as ConnectToParentOptions,
  LiteParentHandle as ParentHandle,
} from '../core/childConnection';
export { connectToParentLite as connectToParent } from '../core/childConnection';
export type { ErrorCode } from '../core/errors';
export { IframeKitError, isIframeKitError } from '../core/errors';
export type { MeasureFn, Size } from '../core/measure';
export type { OriginMatcher } from '../core/origin';
