/**
 * The child side of the handshake: one connection per page, shared by every
 * `connectToParent` caller. See docs/design.md → Handshake, Connection sharing,
 * Resize (child `autoResize`).
 */
import { logProtocolMessage } from './debugLog';
import { IframeKitError } from './errors';
import { randomId } from './id';
import { createLoopGuard, type LoopGuard } from './loopGuard';
import type { MeasureFn, Measurement } from './measure';
import { observeSize } from './observeSize';
import {
  normalizeOriginMatchers,
  type OriginMatcher,
  originAllowed,
  sameOriginMatchers,
} from './origin';
import { parsePortMessage, parseWindowMessage, RIK, SUPPORTED_VERSIONS } from './protocol';
import { getRegistry } from './registry';

export type ChildStatus = 'idle' | 'connecting' | 'connected';

export interface ConnectToParentOptions {
  /** Which origins may complete the handshake. Required; see docs/design.md → Security. */
  allowedOrigins: OriginMatcher[];
  unsafeAllowAnyOrigin?: boolean | undefined;
  debug?: boolean | undefined;
  /** Report this page's content size to the parent. See docs/design.md → Resize. */
  autoResize?: boolean | { measure?: MeasureFn | undefined } | undefined;
}

export interface ParentHandle {
  readonly status: ChildStatus;
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

class ChildConnectionImpl {
  status: ChildStatus = 'idle';

  private readonly instance: string;
  private allowedOrigins: OriginMatcher[] = [];
  private refCount = 0;

  private session: string | undefined;
  private port: MessagePort | undefined;
  /** On if any acquirer enabled it. See docs/design.md → Connection sharing. */
  private debug = false;

  private autoResizeUsers = 0;
  private measureFn: MeasureFn | undefined;
  private stopObserving: (() => void) | undefined;
  private loopGuards: { width: LoopGuard; height: LoopGuard } = {
    width: createLoopGuard(),
    height: createLoopGuard(),
  };
  private lastSent: { width: number; height: number; loop: boolean } | undefined;

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
    if (options.debug) this.debug = true;
  }

  release(): void {
    this.refCount--;
    // No teardown: unlike the parent side, there is nothing to defer/dispose here
    // beyond ref counting — the page itself owns the connection's lifetime.
  }

  // A status-subscription method (like the parent connection's) will be added here
  // once `useParent` (roadmap step 6) needs to react to status changes; nothing
  // subscribes yet, so it isn't carried as untested surface until then.

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
    this.port?.close();

    this.session = message.session;
    this.port = port;
    port.onmessage = this.handlePortMessage;
    port.start?.();
    const ready = { rik: RIK, type: 'ready' } as const;
    port.postMessage(ready);
    logProtocolMessage(this.debug, '→', ready);

    this.status = 'connected';
    this.flushSize();
  };

  private handlePortMessage = (event: MessageEvent): void => {
    const message = parsePortMessage(event.data);
    if (message?.type !== 'bye') return;
    logProtocolMessage(this.debug, '←', message);
    this.port?.close();
    this.port = undefined;
    if (this.status === 'connected') this.status = 'connecting';
  };

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
    }
    if (this.status === 'connected') this.status = 'connecting';
  };

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
}

function getConnection(): ChildConnectionImpl {
  const registry = getRegistry();
  registry.childConnection ??= new ChildConnectionImpl();
  return registry.childConnection as ChildConnectionImpl;
}

/**
 * Connects this page to its parent frame. Returns a handle whose `status` tracks the
 * shared page-level connection; call `dispose()` when this caller no longer needs it.
 * A no-op that stays `'idle'` on the server and when the page isn't framed.
 * See docs/design.md → RPC and events API, Resize.
 */
export function connectToParent(options: ConnectToParentOptions): ParentHandle {
  const allowedOrigins = normalizeOriginMatchers(
    options.allowedOrigins,
    options.unsafeAllowAnyOrigin,
  );
  const connection = getConnection();
  connection.acquire({ allowedOrigins, debug: options.debug });
  if (options.autoResize) {
    const measure = typeof options.autoResize === 'object' ? options.autoResize.measure : undefined;
    connection.startAutoResize(measure);
  }

  let disposed = false;
  return {
    get status() {
      return disposed ? 'idle' : connection.status;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (options.autoResize) connection.stopAutoResize();
      connection.release();
    },
  };
}
