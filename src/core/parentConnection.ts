/**
 * The parent side of the handshake: one connection per iframe element, shared by
 * every hook that uses it. See docs/design.md → Handshake, Connection sharing.
 */
import { logProtocolMessage } from './debugLog';
import { IframeKitError } from './errors';
import { randomId } from './id';
import {
  assertWildcardAllowed,
  deriveExpectedOrigin,
  normalizeOrigin,
  OPAQUE,
  WILDCARD,
} from './origin';
import {
  highestCommonVersion,
  parsePortMessage,
  parseWindowMessage,
  RIK,
  SUPPORTED_VERSIONS,
} from './protocol';
import { getRegistry } from './registry';

export type ConnectionStatus = 'connecting' | 'connected';

export interface CachedSize {
  width: number;
  height: number;
  loop: boolean;
}

export interface ParentConnectionOptions {
  /** Already normalized by the caller (`normalizeOrigin`); `undefined` to auto-derive. */
  origin?: string | undefined;
  debug?: boolean | undefined;
}

export interface ParentConnection {
  readonly status: ConnectionStatus;
  readonly cachedSize: CachedSize | undefined;
  /** Fires immediately with the current status, then on every change. */
  onStatusChange(callback: (status: ConnectionStatus) => void): () => void;
  /** Fires immediately with the cached size if there is one, then on every new report. */
  onSize(callback: (size: CachedSize) => void): () => void;
  release(): void;
}

function connectionsMap(): WeakMap<HTMLIFrameElement, ParentConnectionImpl> {
  const registry = getRegistry();
  registry.parentConnections ??= new WeakMap();
  return registry.parentConnections as WeakMap<HTMLIFrameElement, ParentConnectionImpl>;
}

class ParentConnectionImpl implements ParentConnection {
  status: ConnectionStatus = 'connecting';
  cachedSize: CachedSize | undefined;

  private refCount = 0;
  private disposeTimer: ReturnType<typeof setTimeout> | undefined;
  private explicitOrigin: string | undefined;
  /** On if any acquirer enabled it. See docs/design.md → Connection sharing. */
  private debug = false;

  /** The instance we're either pending on or fully connected with. */
  private knownInstance: string | undefined;
  private pendingPort: MessagePort | undefined;
  private connectedPort: MessagePort | undefined;

  private statusListeners = new Set<(status: ConnectionStatus) => void>();
  private sizeListeners = new Set<(size: CachedSize) => void>();

  constructor(private readonly iframe: HTMLIFrameElement) {
    window.addEventListener('message', this.handleWindowMessage);
    iframe.addEventListener('load', this.handleIframeLoad);
    this.sendSyn();
  }

  acquire(options: ParentConnectionOptions): void {
    if (
      options.origin !== undefined &&
      this.explicitOrigin !== undefined &&
      this.explicitOrigin !== options.origin
    ) {
      throw new IframeKitError(
        'RIK_ORIGIN_CONFLICT',
        'react-iframe-kit: two users of the same iframe passed different `origin` values.',
      );
    }
    if (this.disposeTimer !== undefined) {
      clearTimeout(this.disposeTimer);
      this.disposeTimer = undefined;
    }
    this.refCount++;
    if (options.origin !== undefined) this.explicitOrigin = options.origin;
    if (options.debug) this.debug = true;
  }

  release(): void {
    this.refCount--;
    if (this.refCount > 0) return;
    // Deferred so a StrictMode double mount/unmount, or a hook remount across the same
    // iframe, reuses the open port instead of tearing the handshake down and back up.
    this.disposeTimer = setTimeout(() => this.dispose(), 0);
  }

  onStatusChange(callback: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(callback);
    callback(this.status);
    return () => this.statusListeners.delete(callback);
  }

  onSize(callback: (size: CachedSize) => void): () => void {
    this.sizeListeners.add(callback);
    if (this.cachedSize) callback(this.cachedSize);
    return () => this.sizeListeners.delete(callback);
  }

  private expectedOrigin(): string {
    return this.explicitOrigin ?? deriveExpectedOrigin(this.iframe);
  }

  private sendSyn(): void {
    const target = this.iframe.contentWindow;
    if (!target) return;
    const expected = this.expectedOrigin();
    const targetOrigin = expected === OPAQUE || expected === WILDCARD ? WILDCARD : expected;
    const message = { rik: RIK, type: 'syn', versions: SUPPORTED_VERSIONS } as const;
    try {
      target.postMessage(message, targetOrigin);
      logProtocolMessage(this.debug, '→', message);
    } catch {
      // A cross-origin-isolated target or similar can make this throw; there is
      // nothing useful to do besides not crashing.
    }
  }

  /** Resets to `'connecting'` without sending a syn (a reply/ack is coming instead). */
  private resetToConnecting(): void {
    this.cachedSize = undefined;
    if (this.status !== 'connecting') {
      this.status = 'connecting';
      this.notifyStatus();
    }
  }

  private enterConnecting(): void {
    this.resetToConnecting();
    this.sendSyn();
  }

  private notifyStatus(): void {
    for (const listener of this.statusListeners) listener(this.status);
  }

  private handleWindowMessage = (event: MessageEvent): void => {
    if (event.source !== this.iframe.contentWindow) return;
    const message = parseWindowMessage(event.data);
    // Only the child's syn (which carries `instance`) is meaningful here.
    if (message?.type !== 'syn' || message.instance === undefined) return;
    logProtocolMessage(this.debug, '←', message);

    const expected = this.expectedOrigin();
    const originOk =
      expected === WILDCARD ||
      event.origin === expected ||
      (expected === OPAQUE && event.origin === OPAQUE);
    if (!originOk) return;

    if (message.instance === this.knownInstance) return; // duplicate syn for a pending/open session

    if (this.knownInstance !== undefined) {
      // A different instance means the child reloaded: drop the old session silently
      // (its document, and MessagePort, is already gone) and go back to connecting
      // while the new one is pending, mirroring what `bye` does.
      this.teardownPort(false);
      this.knownInstance = undefined;
      this.resetToConnecting();
    }

    const version = highestCommonVersion(SUPPORTED_VERSIONS, message.versions);
    if (version === undefined) {
      /* v8 ignore start: __DEV__ is compile-time; the branch below is dead code (and
       * this whole `if` is stripped) in a production build, so it's unreachable here. */
      if (__DEV__) {
        console.warn(
          `react-iframe-kit: no protocol version in common with the child (we speak ${SUPPORTED_VERSIONS.join(', ')}, it speaks ${message.versions.join(', ')}).`,
        );
      }
      /* v8 ignore stop */
      return;
    }

    const channel = new MessageChannel();
    const session = randomId();
    channel.port1.onmessage = this.handlePortMessage;
    channel.port1.start?.();

    // Target the origin we just validated, not the (possibly wildcard/derived)
    // expectation: it's the tighter, always-correct choice. Opaque origins fall back
    // to '*', since 'null' as a targetOrigin restricts nothing beyond opacity itself.
    const ackTargetOrigin = event.origin === OPAQUE ? WILDCARD : event.origin;
    const ack = { rik: RIK, type: 'ack', session, instance: message.instance, version } as const;
    try {
      this.iframe.contentWindow?.postMessage(ack, ackTargetOrigin, [channel.port2]);
      logProtocolMessage(this.debug, '→', ack);
    } catch {
      channel.port1.close();
      return;
    }
    this.knownInstance = message.instance;
    this.pendingPort = channel.port1;
  };

  private handleIframeLoad = (): void => {
    if (this.status === 'connecting') this.sendSyn();
  };

  private handlePortMessage = (event: MessageEvent): void => {
    const message = parsePortMessage(event.data);
    if (!message) return;
    logProtocolMessage(this.debug, '←', message);

    // A switch, not if/else if: TypeScript proves this covers all of PortMessage's 3
    // members, and unlike an if-chain a switch with no default has no "else" branch
    // for a coverage tool to flag as unreachable.
    switch (message.type) {
      case 'ready':
        this.connectedPort = this.pendingPort;
        this.pendingPort = undefined;
        this.status = 'connected';
        this.notifyStatus();
        break;
      case 'size': {
        const size: CachedSize = {
          width: message.width,
          height: message.height,
          loop: message.loop ?? false,
        };
        this.cachedSize = size;
        for (const listener of this.sizeListeners) listener(size);
        break;
      }
      case 'bye':
        this.teardownPort(false);
        this.knownInstance = undefined;
        this.enterConnecting();
        break;
    }
  };

  private teardownPort(sendBye: boolean): void {
    const port = this.connectedPort ?? this.pendingPort;
    if (port && sendBye) {
      const bye = { rik: RIK, type: 'bye' } as const;
      try {
        port.postMessage(bye);
        logProtocolMessage(this.debug, '→', bye);
      } catch {
        // The document on the other end may already be gone.
      }
    }
    port?.close();
    this.connectedPort = undefined;
    this.pendingPort = undefined;
  }

  private dispose(): void {
    this.teardownPort(true);
    window.removeEventListener('message', this.handleWindowMessage);
    this.iframe.removeEventListener('load', this.handleIframeLoad);
    connectionsMap().delete(this.iframe);
  }
}

/**
 * Acquires the shared connection for `iframe`, creating it on first use. Every
 * acquirer must call the returned connection's release-equivalent exactly once
 * (`connection.release()`) when done. Throws `RIK_INVALID_OPTIONS` for an unsafe
 * `origin` and `RIK_ORIGIN_CONFLICT` if a different `origin` was already acquired by
 * someone else on the same iframe.
 */
export function acquireParentConnection(
  iframe: HTMLIFrameElement,
  options: {
    origin?: string | undefined;
    unsafeAllowAnyOrigin?: boolean | undefined;
    debug?: boolean | undefined;
  },
): ParentConnection {
  let origin: string | undefined;
  if (options.origin !== undefined) {
    origin = normalizeOrigin(options.origin);
    assertWildcardAllowed(origin, options.unsafeAllowAnyOrigin, '`origin`');
  }

  const map = connectionsMap();
  let connection = map.get(iframe);
  if (!connection) {
    connection = new ParentConnectionImpl(iframe);
    map.set(iframe, connection);
  }
  connection.acquire({ origin, debug: options.debug });
  return connection;
}
