// Parent entry: `react-iframe-kit`. See docs/design.md → Package layout.

export type { ErrorCode, SerializedError, TimeoutPhase } from './core/errors';
export { IframeKitError, isIframeKitError, RemoteError, TimeoutError } from './core/errors';
export type { MeasureFn, Size } from './core/measure';
export type { FrameContextValue } from './react/context';
export { useFrame } from './react/context';
export type { FrameProps } from './react/Frame';
export { Frame } from './react/Frame';
export type { UseIframeOptions, UseIframeResult } from './react/useIframe';
export { useIframe } from './react/useIframe';
export type { ResizeAxis, UseIframeResizeOptions } from './react/useIframeResize';
export { useIframeResize } from './react/useIframeResize';
export type { IframeTarget } from './react/useIframeTarget';
