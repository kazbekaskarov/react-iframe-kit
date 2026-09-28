// Parent entry: `react-iframe-kit`. See docs/design.md → Package layout.

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
} from './core/contract';
export type { ErrorCode, SerializedError, TimeoutPhase } from './core/errors';
export { IframeKitError, isIframeKitError, RemoteError, TimeoutError } from './core/errors';
export type { MeasureFn, Size } from './core/measure';
export type { CallOptions } from './core/remote';
export { withOptions } from './core/remote';
export type { TrustedHTMLLike } from './core/srcdoc';
export { transfer } from './core/transfer';
export type { FrameContextValue } from './react/context';
export { useFrame } from './react/context';
export type { FrameProps } from './react/Frame';
export { Frame } from './react/Frame';
export type { UseIframeOptions, UseIframeResult } from './react/useIframe';
export { useIframe } from './react/useIframe';
export type { UseIframeEventOptions } from './react/useIframeEvent';
export { useIframeEvent } from './react/useIframeEvent';
export type { UseIframeInertOptions } from './react/useIframeInert';
export { useIframeInert } from './react/useIframeInert';
export type { ResizeAxis, UseIframeResizeOptions } from './react/useIframeResize';
export { useIframeResize } from './react/useIframeResize';
export type { RPCStatus, UseIframeRPCOptions, UseIframeRPCResult } from './react/useIframeRPC';
export { useIframeRPC } from './react/useIframeRPC';
export type { IframeTarget } from './react/useIframeTarget';
export type { UseIframeTitleOptions } from './react/useIframeTitle';
export { useIframeTitle } from './react/useIframeTitle';
