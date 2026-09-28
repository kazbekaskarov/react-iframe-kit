/**
 * A stand-in for the page that embeds this one, for testing the child side
 * (`connectToParent`, `useParent`, `useParentEvent`) in jsdom or happy-dom, where the
 * test page isn't framed. It frames the page (`window.parent` becomes another window),
 * then speaks the real protocol, through the real RPC engine. See docs/design.md →
 * Testing utilities.
 */
import type { AnySide, Emit, LocalMethods, On, Remote, SideShape } from '../core/contract';
import { IframeKitError } from '../core/errors';
import { randomId } from '../core/id';
import { parsePortMessage, parseWindowMessage, RIK, SUPPORTED_VERSIONS } from '../core/protocol';
import { getRegistry } from '../core/registry';
import { type RpcAcquireOptions, RpcEngine } from '../core/rpc';
import { interceptPostMessage, receiveMessage } from './intercept';

export type MockParentStatus = 'connecting' | 'connected' | 'disposed';

export interface MockParentOptions<LocalSide extends SideShape = AnySide> {
  /** Methods the page under test may call. */
  methods?: LocalMethods<LocalSide> | undefined;
  /**
   * The mock parent's origin, which the page's `allowedOrigins` must accept. Default:
   * the test page's own origin.
   */
  origin?: string | undefined;
  /** Per call to the page, from send to result. Default 10 s. */
  timeout?: number | undefined;
  connectTimeout?: number | undefined;
}

export interface MockParent<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
> {
  readonly status: MockParentStatus;
  /** The page's methods; calls made before connecting are queued. */
  remote: Remote<RemoteSide>;
  /** Emits one of the mock parent's events to the page. */
  emit: Emit<LocalSide>;
  /** Subscribes to one of the page's events; returns the unsubscribe function. */
  on: On<RemoteSide>;
  /** The last size the page reported with `autoResize`, if any. */
  readonly size: { width: number; height: number } | undefined;
  /** The last title the page reported with `syncTitle`, if any. */
  readonly title: string | undefined;
  /** Resolves once the handshake with the page completes. */
  whenConnected(): Promise<void>;
  /**
   * Goes away like an unmounting parent: sends `bye`, so the page's pending calls
   * reject with `RIK_CONNECTION_LOST`, and un-frames the page.
   */
  dispose(): void;
}

/**
 * Frames this page and plays its parent. Create it before the code under test calls
 * `connectToParent` (or renders `useParent`). Pass the page's side first, like
 * `useIframeRPC`: `mockParent<ChildSide, ParentSide>({ methods })`.
 */
export function mockParent<
  RemoteSide extends SideShape = AnySide,
  LocalSide extends SideShape = AnySide,
>(options: MockParentOptions<LocalSide> = {}): MockParent<RemoteSide, LocalSide> {
  const origin = options.origin ?? location.origin;

  // The parent must be a real window: jsdom rejects a `MessageEvent` whose `source`
  // isn't one. An iframe of our own provides it.
  const holder = document.createElement('iframe');
  holder.hidden = true;
  document.body.append(holder);
  const parent = holder.contentWindow as Window;

  // A page connection made while the page wasn't framed stays idle for good; drop it so
  // the next `connectToParent` starts a framed one.
  const registry = getRegistry();
  if ((registry.childConnection as { status?: string } | undefined)?.status === 'idle') {
    delete registry.childConnection;
  }
  const ownParent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });

  const rpc = new RpcEngine();
  const handle = rpc.acquire(
    {},
    {
      methods: options.methods as RpcAcquireOptions['methods'],
      timeout: options.timeout,
      connectTimeout: options.connectTimeout,
    },
  );

  let status: MockParentStatus = 'connecting';
  let instance: string | undefined;
  let port: MessagePort | undefined;
  let size: { width: number; height: number } | undefined;
  let title: string | undefined;
  const connectedWaiters = new Set<{ resolve: () => void; reject: (error: unknown) => void }>();
  const destroyed = () =>
    new IframeKitError('RIK_DESTROYED', 'react-iframe-kit/testing: the mock parent was disposed.');

  const closePort = () => {
    port?.close();
    port = undefined;
    rpc.disconnected();
  };

  const onPortMessage = (event: MessageEvent) => {
    const message = parsePortMessage(event.data);
    switch (message?.type) {
      case 'ready': {
        status = 'connected';
        const connected = event.target as MessagePort;
        rpc.connected((rpcMessage, transferables) =>
          connected.postMessage(rpcMessage, transferables),
        );
        for (const { resolve } of connectedWaiters) resolve();
        connectedWaiters.clear();
        break;
      }
      case 'size':
        size = { width: message.width, height: message.height };
        break;
      case 'title':
        title = message.title;
        break;
      case 'call':
        rpc.handleCall(message);
        break;
      case 'result':
        rpc.handleResult(message);
        break;
      case 'event':
        rpc.handleEvent(message);
        break;
      case 'bye':
        closePort();
        instance = undefined;
        status = 'connecting';
        break;
    }
  };

  // What the page sends to its parent: its syn.
  const restorePostMessage = interceptPostMessage(parent, (data) => {
    if (status === 'disposed') return;
    const message = parseWindowMessage(data);
    if (message?.type !== 'syn' || message.instance === undefined) return;
    if (message.instance === instance && port) return; // a duplicate for this session
    closePort();
    instance = message.instance;
    status = 'connecting';
    const channel = new MessageChannel();
    port = channel.port1;
    port.onmessage = onPortMessage;
    port.start();
    receiveMessage(
      { rik: RIK, type: 'ack', session: randomId(), instance, version: 1 },
      origin,
      parent,
      [channel.port2],
    );
  });

  // Prompts a page that is already connecting (e.g. from an earlier mock) to announce
  // itself; a page that connects later sends its own syn.
  receiveMessage({ rik: RIK, type: 'syn', versions: SUPPORTED_VERSIONS }, origin, parent);

  return {
    get status() {
      return status;
    },
    remote: handle.remote as Remote<RemoteSide>,
    emit: handle.emit as Emit<LocalSide>,
    on: handle.on as On<RemoteSide>,
    get size() {
      return size;
    },
    get title() {
      return title;
    },
    whenConnected() {
      if (status === 'connected') return Promise.resolve();
      if (status === 'disposed') return Promise.reject(destroyed());
      return new Promise<void>((resolve, reject) => connectedWaiters.add({ resolve, reject }));
    },
    dispose() {
      if (status === 'disposed') return;
      port?.postMessage({ rik: RIK, type: 'bye' });
      closePort();
      handle.release();
      status = 'disposed';
      for (const { reject } of connectedWaiters) reject(destroyed());
      connectedWaiters.clear();
      restorePostMessage();
      if (ownParent) Object.defineProperty(window, 'parent', ownParent);
      else delete (window as { parent?: unknown }).parent;
      holder.remove();
    },
  };
}
