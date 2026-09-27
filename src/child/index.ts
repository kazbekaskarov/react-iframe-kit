// Child entry: `react-iframe-kit/child`. Must not depend on React.
// See docs/design.md → Package layout.

export type { ChildStatus, ConnectToParentOptions, ParentHandle } from '../core/childConnection';
export { connectToParent } from '../core/childConnection';
export type { ErrorCode, SerializedError, TimeoutPhase } from '../core/errors';
export { IframeKitError, isIframeKitError, RemoteError, TimeoutError } from '../core/errors';
export type { MeasureFn, Size } from '../core/measure';
export type { OriginMatcher } from '../core/origin';
