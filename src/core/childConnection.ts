/**
 * The child side of the handshake: one connection per page, shared by every
 * `connectToParent` caller, and the lite `connectToParent` (no RPC). The full one, with
 * RPC, is in connectToParent.ts. See docs/design.md → Handshake, Connection sharing,
 * Resize (child `autoResize`), Package layout (`child/lite`).
 */

import { logProtocolMessage } from './debugLog';
import { IframeKitError } from './errors';
import { randomId } from './id';
import { makeDocumentInert } from './inert';
import { createLoopGuard, type LoopGuard } from './loopGuard';
import type { MeasureFn, Measurement } from './measure';
import { observeSize } from './observeSize';
import {
  normalizeOriginMatchers,
  type OriginMatcher,
  originAllowed,
  sameOriginMatchers,
} from './origin';
import {
  methodNotFound,
  parsePortMessage,
  parseWindowMessage,
  RIK,
  SUPPORTED_VERSIONS,
} from './protocol';
import { getRegistry } from './registry';
import type { RpcAcquireOptions, RpcEngine, RpcHandle } from './rpc';

export type ChildStatus = 'idle' | 'connecting' | 'connected';

/** `connectToParent` options that need no RPC: all of the lite one's. */
export interface LiteConnectToParentOptions {
  /** Which origins may complete the handshake. Required; see docs/design.md → Security. */
  allowedOrigins: OriginMatcher[];
  unsafeAllowAnyOrigin?: boolean | undefined;
  debug?: boolean | undefined;
  /** Report this page's content size to the parent. See docs/design.md → Resize. */
  autoResize?: boolean | { measure?: MeasureFn | undefined } | undefined;
  /**
   * Send this page's `document.title` to the parent, now and whenever it changes, for
   * `useIframeTitle`. Opt-in: a title can hold private data. See docs/design.md →
   * Title.
   */
  syncTitle?: boolean | undefined;
}

/** The handle of the lite `connectToParent`: the full one's, without RPC. */
export interface LiteParentHandle {
  readonly status: ChildStatus;
  /** Resolves on the next `'connected'`; rejects `RIK_DESTROYED` on dispose. */
  whenConnected(): Promise<void>;
  /** Releases this caller's share of the page's connection. Safe to call once. */
  dispose(): void;
}

// `window.parent` is one of the handful of properties the HTML spec keeps accessible
// across origins without throwing (with `top`, `self`, `closed`, `opener`, ...), so
// this needs no try/catch: `sendSyn()` relies on the same guarantee.
function isFramed(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

function getInstance(): string {
  const registry = getRegistry();
  registry.childInstance ??= randomId();
  return registry.childInstance;
}

export class ChildConnectionImpl {
  status: ChildStatus = 'idle';

  private readonly instance: string;
  private allowedOrigins: OriginMatcher[] = [];
  private refCount = 0;

  private session: string | undefined;
  private port: MessagePort | undefined;
  /** On if any acquirer enabled it. See docs/design.md → Connection sharing. */
  private debug = false;
  /** Created by the first RPC user, so pages without RPC don't bundle it. */
  private rpc: RpcEngine | undefined;
  private statusListeners = new Set<(status: ChildStatus) => void>();

  private autoResizeUsers = 0;
  private measureFn: MeasureFn | undefined;
  private stopObserving: (() => void) | undefined;
  private loopGuards: { width: LoopGuard; height: LoopGuard } = {
    width: createLoopGuard(),
    height: createLoopGuard(),
  };
  private lastSent: { width: number; height: number; loop: boolean } | undefined;

  private titleUsers = 0;
  private stopTitleObserver: (() => void) | undefined;
  /** What the current session last got; `undefined` makes the next flush send. */
  private sentTitle: string | undefined;

  /** Set while the parent asks this page to be inert; undoes it. */
  private undoInert: (() => void) | undefined;

  constructor() {
    this.instance = getInstance();
    if (typeof window === 'undefined' || !isFramed()) return; // SSR, or opened top-level
    this.status = 'connecting';
    window.addEventListener('message', this.handleWindowMessage);
    window.addEventListener('pagehide', this.handlePageHide);
    window.addEventListener('pageshow', this.handlePageShow);
    this.sendSyn();
  }

  /**
   * @internal Test-only: this connection is otherwise page-scoped for its whole
   * lifetime (see docs/design.md → Connection sharing), with no real disposal.
   * Removes the window listeners and closes the port so a test's leftover instance
   * doesn't react to the next test's messages.
   */
  /* v8 ignore start: test-only helper, not exercised as production logic */
  teardownForTests(): void {
    if (typeof window === 'undefined') return;
    window.removeEventListener('message', this.handleWindowMessage);
    window.removeEventListener('pagehide', this.handlePageHide);
    window.removeEventListener('pageshow', this.handlePageShow);
    this.port?.close();
    this.stopObserving?.();
    this.stopTitleObserver?.();
  }
  /* v8 ignore stop */

  acquire(options: { allowedOrigins: OriginMatcher[]; debug?: boolean | undefined }): void {
    if (this.refCount > 0 && !sameOriginMatchers(this.allowedOrigins, options.allowedOrigins)) {
      throw new IframeKitError(
        'RIK_ORIGIN_CONFLICT',
        'react-iframe-kit: two `connectToParent` callers passed different `allowedOrigins`.',
      );
    }
    this.refCount++;
    this.allowedOrigins = options.allowedOrigins;
    if (options.debug) {
      this.debug = true;
      this.rpc?.setDebug(true);
    }
  }

  /**
   * `Engine` is passed in rather than imported, as on the parent side: the lite
   * `connectToParent` never calls this, so it doesn't bundle RPC.
   */
  acquireRpc(user: object, options: RpcAcquireOptions, Engine: typeof RpcEngine): RpcHandle {
    if (!this.rpc) {
      this.rpc = new Engine();
      this.rpc.setDebug(this.debug);
      if (this.port) this.connectRpc(this.port);
    }
    return this.rpc.acquire(user, options);
  }

  // No `logProtocolMessage` in the sender: `RpcEngine` logs what it sends.
  private connectRpc(port: MessagePort): void {
    this.rpc?.connected((rpcMessage, transferables) => port.postMessage(rpcMessage, transferables));
  }

  onStatusChange(callback: (status: ChildStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  release(): void {
    this.refCount--;
    // No teardown: unlike the parent side, there is nothing to defer/dispose here
    // beyond ref counting — the page itself owns the connection's lifetime.
  }

  startAutoResize(measure: MeasureFn | undefined): void {
    if (typeof document === 'undefined') return;
    this.autoResizeUsers++;
    if (this.autoResizeUsers > 1) {
      if (measure && this.measureFn && measure !== this.measureFn) {
        this.autoResizeUsers--;
        throw new IframeKitError(
          'RIK_INVALID_OPTIONS',
          'react-iframe-kit: two `autoResize` callers passed different `measure` functions.',
        );
      }
      this.measureFn ??= measure;
      return;
    }
    this.measureFn = measure;
    this.stopObserving = observeSize(document, this.handleMeasurement, this.measureFn);
  }

  stopAutoResize(): void {
    this.autoResizeUsers--;
    if (this.autoResizeUsers > 0) return;
    this.stopObserving?.();
    this.stopObserving = undefined;
    this.lastSent = undefined;
    this.loopGuards = { width: createLoopGuard(), height: createLoopGuard() };
  }

  startTitleSync(): void {
    if (typeof document === 'undefined') return;
    if (this.titleUsers++ > 0) return;
    // The title is the text of `<title>` in `<head>`: a new element, or new text in it.
    const observer = new MutationObserver(this.flushTitle);
    observer.observe(document.head, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    this.stopTitleObserver = () => observer.disconnect();
    this.flushTitle();
  }

  stopTitleSync(): void {
    if (this.titleUsers === 0 || --this.titleUsers > 0) return;
    this.stopTitleObserver?.();
    this.stopTitleObserver = undefined;
    this.sentTitle = undefined;
  }

  private sendSyn(): void {
    const message = {
      rik: RIK,
      type: 'syn',
      instance: this.instance,
      versions: SUPPORTED_VERSIONS,
    } as const;
    window.parent.postMessage(message, '*');
    logProtocolMessage(this.debug, '→', message);
  }

  private handleWindowMessage = (event: MessageEvent): void => {
    if (event.source !== window.parent) return;
    const message = parseWindowMessage(event.data);
    if (!message) return;
    logProtocolMessage(this.debug, '←', message);

    if (message.type === 'syn') {
      // The parent's own prompt syn carries no instance; reply with ours.
      if (message.instance === undefined) this.sendSyn();
      return;
    }

    // ack
    if (!originAllowed(event.origin, this.allowedOrigins)) {
      /* v8 ignore start: __DEV__ is compile-time; the branch below is dead code (and
       * this whole `if` is stripped) in a production build, so it's unreachable here. */
      if (__DEV__) {
        console.warn(
          `react-iframe-kit: received an "ack" from an origin not in \`allowedOrigins\`: ${event.origin}`,
        );
      }
      /* v8 ignore stop */
      return;
    }
    if (message.instance !== this.instance) return; // stale ack racing a reload
    if (message.session === this.session) return; // duplicate
    if (!SUPPORTED_VERSIONS.includes(message.version)) return; // the parent should have intersected already

    const port = event.ports[0];
    if (!port) return;
    if (this.port) {
      // A replaced session: calls sent over the old port can no longer be answered.
      this.port.close();
      this.rpc?.disconnected();
      this.setInert(false); // the new session says again if it wants it
    }

    this.session = message.session;
    this.port = port;
    port.onmessage = this.handlePortMessage;
    port.start?.();
    const ready = { rik: RIK, type: 'ready' } as const;
    port.postMessage(ready);
    logProtocolMessage(this.debug, '→', ready);

    this.setStatus('connected');
    this.connectRpc(port);
    this.flushSize();
    this.sentTitle = undefined; // a new session hasn't got it yet
    this.flushTitle();
  };

  private handlePortMessage = (event: MessageEvent): void => {
    const message = parsePortMessage(event.data);
    if (!message) return;
    // `ready`/`size` only ever travel child → parent, so they're ignored here.
    // `call`/`result`/`event` are logged by `RpcEngine` itself.
    switch (message.type) {
      case 'bye':
        logProtocolMessage(this.debug, '←', message);
        this.port?.close();
        this.port = undefined;
        this.rpc?.disconnected();
        this.setInert(false);
        this.setStatus('connecting');
        break;
      case 'inert':
        logProtocolMessage(this.debug, '←', message);
        this.setInert(message.inert);
        break;
      case 'call':
        if (this.rpc) this.rpc.handleCall(message);
        else {
          // No RPC on this page (the lite `connectToParent`): answer the way the engine
          // would for a method it doesn't have.
          this.port?.postMessage({
            rik: RIK,
            type: 'result',
            id: message.id,
            ok: false,
            error: methodNotFound(message.method),
          });
        }
        break;
      case 'result':
        this.rpc?.handleResult(message);
        break;
      case 'event':
        this.rpc?.handleEvent(message);
        break;
    }
  };

  private setStatus(status: ChildStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private handlePageHide = (): void => {
    if (this.port) {
      const bye = { rik: RIK, type: 'bye' } as const;
      try {
        this.port.postMessage(bye);
        logProtocolMessage(this.debug, '→', bye);
      } catch {
        // Best effort; the parent will notice through the per-call timeout otherwise.
      }
      this.port.close();
      this.port = undefined;
      this.rpc?.disconnected();
    }
    this.setInert(false);
    this.setStatus('connecting');
  };

  private setInert(inert: boolean): void {
    if (inert) {
      this.undoInert ??= makeDocumentInert(document);
    } else {
      this.undoInert?.();
      this.undoInert = undefined;
    }
  }

  private handlePageShow = (event: PageTransitionEvent): void => {
    if (event.persisted) this.sendSyn();
  };

  private handleMeasurement = (measurement: Measurement): void => {
    const wasTripped = this.loopGuards.width.tripped || this.loopGuards.height.tripped;

    // `lastSent` is provably defined once `check()` can return true: tripping needs
    // LOOP_THRESHOLD consecutive measurements, and the first one always sets
    // `lastSent` (nothing is held yet). The assertion documents that invariant and
    // fails loudly if it's ever violated, instead of a `??` fallback silently
    // producing a plausible-but-wrong size.
    let width = measurement.width;
    if (this.loopGuards.width.check(measurement.width, measurement.viewport.width)) {
      // biome-ignore lint/style/noNonNullAssertion: see the invariant above
      width = this.lastSent!.width;
    }
    let height = measurement.height;
    if (this.loopGuards.height.check(measurement.height, measurement.viewport.height)) {
      // biome-ignore lint/style/noNonNullAssertion: see the invariant above
      height = this.lastSent!.height;
    }
    const loop = this.loopGuards.width.tripped || this.loopGuards.height.tripped;

    if (__DEV__ && loop && !wasTripped) {
      console.warn(
        'react-iframe-kit: the content keeps growing with the iframe (content sized from the viewport, e.g. `100vh` or `100%` plus a margin or padding?). Reporting is paused until the content changes.',
      );
    }

    if (
      this.lastSent &&
      this.lastSent.width === width &&
      this.lastSent.height === height &&
      this.lastSent.loop === loop
    ) {
      return;
    }
    this.lastSent = { width, height, loop };
    this.flushSize();
  };

  private flushSize(): void {
    if (this.status !== 'connected' || !this.port || !this.lastSent) return;
    const { width, height, loop } = this.lastSent;
    const message = { rik: RIK, type: 'size', width, height, loop: loop || undefined } as const;
    this.port.postMessage(message);
    logProtocolMessage(this.debug, '→', message);
  }

  private flushTitle = (): void => {
    if (this.titleUsers === 0 || this.status !== 'connected' || !this.port) return;
    const title = document.title.trim();
    if (title === this.sentTitle) return;
    this.sentTitle = title;
    const message = { rik: RIK, type: 'title', title } as const;
    this.port.postMessage(message);
    logProtocolMessage(this.debug, '→', message);
  };
}

/** @internal The page's one connection, created on first use. */
export function getChildConnection(): ChildConnectionImpl {
  const registry = getRegistry();
  registry.childConnection ??= new ChildConnectionImpl();
  return registry.childConnection as ChildConnectionImpl;
}

/**
 * @internal The part both `connectToParent`s share. `setup` adds the caller's own part
 * (the full one's RPC) and returns its cleanup; it runs after the connection is
 * acquired, and a throw from it or from `autoResize` releases everything taken so far.
 */
export function openParentHandle(
  options: LiteConnectToParentOptions,
  setup?: (connection: ChildConnectionImpl) => () => void,
): LiteParentHandle {
  const allowedOrigins = normalizeOriginMatchers(
    options.allowedOrigins,
    options.unsafeAllowAnyOrigin,
  );
  const connection = getChildConnection();
  connection.acquire({ allowedOrigins, debug: options.debug });

  let cleanup: (() => void) | undefined;
  try {
    cleanup = setup?.(connection);
    if (options.autoResize) {
      connection.startAutoResize(
        typeof options.autoResize === 'object' ? options.autoResize.measure : undefined,
      );
    }
  } catch (error) {
    cleanup?.();
    connection.release();
    throw error;
  }

  if (options.syncTitle) connection.startTitleSync();

  let disposed = false;
  const waiters = new Set<() => void>();
  const destroyed = () =>
    new IframeKitError('RIK_DESTROYED', 'react-iframe-kit: the parent handle was disposed.');

  return {
    get status() {
      return disposed ? 'idle' : connection.status;
    },
    whenConnected() {
      if (disposed) return Promise.reject(destroyed());
      if (connection.status === 'connected') return Promise.resolve();
      return new Promise<void>((resolve, reject) => {
        const off = connection.onStatusChange((status) => {
          if (status !== 'connected') return;
          off();
          waiters.delete(onDispose);
          resolve();
        });
        const onDispose = () => {
          off();
          reject(destroyed());
        };
        waiters.add(onDispose);
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const onDispose of waiters) onDispose();
      waiters.clear();
      cleanup?.();
      if (options.autoResize) connection.stopAutoResize();
      if (options.syncTitle) connection.stopTitleSync();
      connection.release();
    },
  };
}

/**
 * The lite `connectToParent` (`react-iframe-kit/child/lite`): the connection with
 * `autoResize`, `syncTitle` and inert, and no RPC, so it doesn't bundle the RPC engine.
 * It shares the page's connection with the full `connectToParent`. See docs/design.md →
 * Package layout.
 */
export function connectToParentLite(options: LiteConnectToParentOptions): LiteParentHandle {
  return openParentHandle(options);
}

/** @internal For `useParent`: fires immediately with the page connection's status. */
export function onParentStatusChange(callback: (status: ChildStatus) => void): () => void {
  return getChildConnection().onStatusChange(callback);
}
