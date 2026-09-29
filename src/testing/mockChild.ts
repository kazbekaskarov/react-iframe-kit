/**
 * A stand-in for the page inside an iframe, for testing the parent side (`useIframeRPC`,
 * `useIframeEvent`, `useIframeResize`, `useIframeTitle`) in jsdom or happy-dom, where
 * the iframe has no real page. It speaks the real protocol, through the real RPC engine,
 * over the iframe's own `contentWindow`. See docs/design.md → Testing utilities.
 */
import type { AnySide, Emit, LocalMethods, On, Remote, SideShape } from '../core/contract';
import { IframeKitError } from '../core/errors';
import { randomId } from '../core/id';
import { deriveExpectedOrigin, OPAQUE } from '../core/origin';
import {
  type PortMessage,
  parsePortMessage,
  parseWindowMessage,
  RIK,
  SUPPORTED_VERSIONS,
} from '../core/protocol';
import { type RpcAcquireOptions, RpcEngine } from '../core/rpc';
import { interceptPostMessage, receiveMessage } from './intercept';

export type MockChildStatus = 'connecting' | 'connected' | 'disposed';

export interface MockChildOptions<LocalSide extends SideShape = AnySide> {
  /** Methods the parent may call. */
  methods?: LocalMethods<LocalSide> | undefined;
  /**
   * The origin the mock page's messages come from. Default: the origin the parent
   * expects from the iframe's `src` (the test page's own origin without one).
   */
  origin?: string | undefined;
  /** Per call to the parent, from send to result. Default 10 s. */
  timeout?: number | undefined;
  connectTimeout?: number | undefined;
}

export interface MockChild<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
> {
  readonly status: MockChildStatus;
  /** Whether the parent currently asks the page to be inert (`useIframeInert`). */
  readonly inert: boolean;
  /** The parent's methods; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of the mock page's events to the parent. */
  emit: Emit<LocalSide>;
  /** Subscribes to one of the parent's events; returns the unsubscribe function. */
  on: On<RemoteSide>;
  /**
   * Reports a content size, as the page's `autoResize` would. Sent once connected.
   * `loop: true` reports the page's feedback-loop guard holding growth.
   */
  resize(size: { width: number; height: number; loop?: boolean | undefined }): void;
  /** Reports a page title, as the page's `syncTitle` would. Sent once connected. */
  setTitle(title: string): void;
  /** Resolves once the handshake with the parent completes. */
  whenConnected(): Promise<void>;
  /**
   * Unloads the mock page: sends `bye`, so the parent rejects pending calls with
   * `RIK_CONNECTION_LOST`, and restores the iframe's `contentWindow.postMessage`.
   */
  dispose(): void;
}

/**
 * Plays the page inside `iframe` for the parent side under test. `iframe` must be in
 * the document. Pass the parent's side first, like `connectToParent`:
 * `mockChild<ParentSide, ChildSide>(iframe, { methods })`.
 */
export function mockChild<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(
  iframe: HTMLIFrameElement,
  options: MockChildOptions<LocalSide> = {},
): MockChild<RemoteSide, LocalSide> {
  const target = iframe.contentWindow;
  if (!target) {
    throw new IframeKitError(
      'RIK_INVALID_OPTIONS',
      'react-iframe-kit/testing: mockChild needs an iframe that is in the document (it has no `contentWindow` yet).',
    );
  }
  const expected = deriveExpectedOrigin(iframe);
  const origin = options.origin ?? (expected === OPAQUE ? 'null' : expected);
  const instance = randomId();

  const rpc = new RpcEngine();
  const handle = rpc.acquire(
    {},
    {
      methods: options.methods as RpcAcquireOptions['methods'],
      timeout: options.timeout,
      connectTimeout: options.connectTimeout,
    },
  );

  let status: MockChildStatus = 'connecting';
  let session: string | undefined;
  let port: MessagePort | undefined;
  let size: { width: number; height: number; loop?: boolean | undefined } | undefined;
  let title: string | undefined;
  let inert = false;
  const connectedWaiters = new Set<{ resolve: () => void; reject: (error: unknown) => void }>();
  const destroyed = () =>
    new IframeKitError('RIK_DESTROYED', 'react-iframe-kit/testing: the mock child was disposed.');

  const post = (message: PortMessage) => port?.postMessage(message);
  const flush = () => {
    if (size) post({ rik: RIK, type: 'size', ...size });
    if (title !== undefined) post({ rik: RIK, type: 'title', title });
  };

  const sendSyn = () =>
    receiveMessage(
      { rik: RIK, type: 'syn', instance, versions: SUPPORTED_VERSIONS },
      origin,
      target,
    );

  const closePort = () => {
    port?.close();
    port = undefined;
    rpc.disconnected();
    inert = false; // like the real page: a session's request ends with it
  };

  const onPortMessage = (event: MessageEvent) => {
    const message = parsePortMessage(event.data);
    if (message?.type === 'call') rpc.handleCall(message);
    else if (message?.type === 'result') rpc.handleResult(message);
    else if (message?.type === 'event') rpc.handleEvent(message);
    else if (message?.type === 'inert') inert = message.inert;
    else if (message?.type === 'bye') {
      closePort();
      status = 'connecting';
    }
  };

  // What the parent sends to the iframe's window: its syn prompts and the ack.
  const restorePostMessage = interceptPostMessage(target, (data, transfer) => {
    if (status === 'disposed') return;
    const message = parseWindowMessage(data);
    if (message?.type === 'syn') {
      if (message.instance === undefined) sendSyn();
      return;
    }
    if (message?.type !== 'ack' || message.instance !== instance || message.session === session) {
      return;
    }
    // Checked by shape: the environment's `MessagePort` global may not be the class
    // the channel came from.
    const received = transfer?.[0] as MessagePort | undefined;
    if (typeof received?.postMessage !== 'function') return;
    closePort();
    session = message.session;
    port = received;
    port.onmessage = onPortMessage;
    port.start();
    post({ rik: RIK, type: 'ready' });
    status = 'connected';
    const connected = port;
    rpc.connected((rpcMessage, transferables) => connected.postMessage(rpcMessage, transferables));
    flush();
    for (const { resolve } of connectedWaiters) resolve();
    connectedWaiters.clear();
  });

  sendSyn();

  return {
    get status() {
      return status;
    },
    get inert() {
      return inert;
    },
    remote: handle.remote as Remote<RemoteSide>,
    emit: handle.emit as Emit<LocalSide>,
    on: handle.on as On<RemoteSide>,
    resize(next) {
      size = { width: next.width, height: next.height, loop: next.loop || undefined };
      if (status === 'connected') post({ rik: RIK, type: 'size', ...size });
    },
    setTitle(next) {
      title = next;
      if (status === 'connected') post({ rik: RIK, type: 'title', title });
    },
    whenConnected() {
      if (status === 'connected') return Promise.resolve();
      if (status === 'disposed') return Promise.reject(destroyed());
      return new Promise<void>((resolve, reject) => connectedWaiters.add({ resolve, reject }));
    },
    dispose() {
      if (status === 'disposed') return;
      post({ rik: RIK, type: 'bye' });
      closePort();
      handle.release();
      status = 'disposed';
      for (const { reject } of connectedWaiters) reject(destroyed());
      connectedWaiters.clear();
      restorePostMessage();
    },
  };
}
