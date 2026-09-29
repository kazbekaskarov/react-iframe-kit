// Host entry: `react-iframe-kit/host`. The parent side without React, for host pages
// that aren't React apps. Must not depend on React. See docs/design.md → Host without
// React.

export type { ResizeAxis } from '../core/applySize';
export type {
  ConnectToIframeOptions,
  IframeHandle,
  IframeResizeOptions,
  IframeStatus,
} from '../core/connectToIframe';
export { connectToIframe } from '../core/connectToIframe';
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
export type { Size } from '../core/measure';
export type { CallOptions } from '../core/remote';
export { withOptions } from '../core/remote';
export { transfer } from '../core/transfer';
