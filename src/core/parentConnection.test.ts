import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeKitError } from './errors';
import { acquireParentConnection, type ParentConnection } from './parentConnection';

interface FakeChildWindow {
  postMessage: ReturnType<typeof vi.fn>;
}

function expectCode(fn: () => unknown, code: string): void {
  expect(fn).toThrow(IframeKitError);
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(IframeKitError);
    expect((error as IframeKitError).code).toBe(code);
  }
}

function createIframe(): { iframe: HTMLIFrameElement; child: FakeChildWindow } {
  const iframe = document.createElement('iframe');
  document.body.append(iframe);
  const child: FakeChildWindow = { postMessage: vi.fn() };
  Object.defineProperty(iframe, 'contentWindow', { value: child, configurable: true });
  return { iframe, child };
}

function synFromChild(
  child: FakeChildWindow,
  instance: string,
  origin: string,
  versions: number[] = [1],
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { rik: 1, type: 'syn', instance, versions },
      origin,
      source: child as unknown as Window,
    }),
  );
}

/** The `MessagePort` the parent sent in its most recent `ack`, or `undefined`. */
function lastAckPort(child: FakeChildWindow): MessagePort | undefined {
  const call = [...child.postMessage.mock.calls].reverse().find((c) => c[0]?.type === 'ack');
  return call?.[2]?.[0];
}

function lastAck(
  child: FakeChildWindow,
): { session: string; instance: string; version: number } | undefined {
  const call = [...child.postMessage.mock.calls].reverse().find((c) => c[0]?.type === 'ack');
  return call?.[0];
}

// Real `MessagePort` delivery is asynchronous and not guaranteed to share a macrotask
// queue with `setTimeout`, so tests wait for the actual observable effect instead of a
// fixed delay.
function waitFor(condition: () => boolean): Promise<void> {
  return vi.waitFor(() => {
    if (!condition()) throw new Error('condition not yet true');
  });
}

/** Completes a full handshake for `instance`/`origin` and returns the child's port. */
async function connect(
  connection: ParentConnection,
  child: FakeChildWindow,
  instance: string,
  origin: string,
): Promise<MessagePort> {
  synFromChild(child, instance, origin);
  const port = lastAckPort(child);
  if (!port) throw new Error('no ack was sent');
  port.postMessage({ rik: 1, type: 'ready' });
  await waitFor(() => connection.status === 'connected');
  return port;
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('acquireParentConnection', () => {
  it('sends a syn immediately on first acquire', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    expect(child.postMessage).toHaveBeenCalledWith(
      { rik: 1, type: 'syn', versions: [1] },
      location.origin,
    );
  });

  it('does not crash when contentWindow is null', () => {
    const iframe = document.createElement('iframe');
    document.body.append(iframe);
    expect(() => acquireParentConnection(iframe, {})).not.toThrow();
  });

  it('returns the same connection for repeat acquires on the same iframe', () => {
    const { iframe } = createIframe();
    const a = acquireParentConnection(iframe, {});
    const b = acquireParentConnection(iframe, {});
    expect(a).toBe(b);
  });

  it('returns a different connection per iframe element', () => {
    const { iframe: i1 } = createIframe();
    const { iframe: i2 } = createIframe();
    expect(acquireParentConnection(i1, {})).not.toBe(acquireParentConnection(i2, {}));
  });

  it('normalizes an explicit origin (case, trailing slash)', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: 'https://Example.com/' });
    synFromChild(child, 'i1', 'https://example.com');
    expect(lastAckPort(child)).toBeDefined();
  });

  it('throws RIK_INVALID_OPTIONS for "*" without unsafeAllowAnyOrigin, before creating a connection', () => {
    const { iframe } = createIframe();
    expectCode(() => acquireParentConnection(iframe, { origin: '*' }), 'RIK_INVALID_OPTIONS');
  });

  it('accepts "*" with unsafeAllowAnyOrigin', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: '*', unsafeAllowAnyOrigin: true });
    synFromChild(child, 'i1', 'https://anything.example');
    expect(lastAckPort(child)).toBeDefined();
  });

  it('throws RIK_ORIGIN_CONFLICT when a second acquirer passes a different origin', () => {
    const { iframe } = createIframe();
    acquireParentConnection(iframe, { origin: 'https://a.example' });
    expectCode(
      () => acquireParentConnection(iframe, { origin: 'https://b.example' }),
      'RIK_ORIGIN_CONFLICT',
    );
  });

  it('does not conflict when only one acquirer passes an explicit origin', () => {
    const { iframe } = createIframe();
    acquireParentConnection(iframe, {});
    expect(() => acquireParentConnection(iframe, { origin: 'https://a.example' })).not.toThrow();
  });

  it('debug: true logs protocol traffic to the console (on if any acquirer enables it)', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {}); // no debug from this acquirer...
    acquireParentConnection(iframe, { debug: true }); // ...but this one turns it on
    debug.mockClear();
    synFromChild(child, 'i1', location.origin);
    expect(debug).toHaveBeenCalled();
  });

  it('release() while another acquirer remains does not tear the connection down', () => {
    vi.useFakeTimers();
    const { iframe } = createIframe();
    const first = acquireParentConnection(iframe, {});
    const second = acquireParentConnection(iframe, {});
    first.release(); // refCount 2 -> 1: still in use, so no disposal is scheduled
    vi.advanceTimersByTime(1000);

    // A disposed-then-recreated connection would be a different object (the WeakMap
    // entry is removed on real disposal); getting the same one back proves it wasn't.
    expect(acquireParentConnection(iframe, {})).toBe(second);
  });
});

describe('syn on iframe load', () => {
  it('resends syn while connecting', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    child.postMessage.mockClear();
    iframe.dispatchEvent(new Event('load'));
    expect(child.postMessage).toHaveBeenCalledWith(
      { rik: 1, type: 'syn', versions: [1] },
      location.origin,
    );
  });

  it('does not resend syn once connected', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    await connect(connection, child, 'i1', location.origin);
    child.postMessage.mockClear();
    iframe.dispatchEvent(new Event('load'));
    expect(child.postMessage).not.toHaveBeenCalled();
  });
});

describe('handshake', () => {
  it('ignores a message from a different source', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    child.postMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'syn', instance: 'i1', versions: [1] },
        origin: location.origin,
        source: {} as unknown as Window,
      }),
    );
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('ignores the parent-shaped prompt syn (no instance) as an incoming message', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    child.postMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'syn', versions: [1] },
        origin: location.origin,
        source: child as unknown as Window,
      }),
    );
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('ignores a syn from an unexpected origin', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: 'https://a.example' });
    synFromChild(child, 'i1', 'https://evil.example');
    expect(lastAckPort(child)).toBeUndefined();
  });

  it('ignores a syn with no common protocol version and warns in dev', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    synFromChild(child, 'i1', location.origin, [99]);
    expect(lastAckPort(child)).toBeUndefined();
    expect(warn).toHaveBeenCalledOnce();
  });

  it('completes the handshake and reaches connected on ready', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const statuses: string[] = [];
    connection.onStatusChange((s) => statuses.push(s));

    synFromChild(child, 'i1', location.origin);
    expect(connection.status).toBe('connecting'); // ack sent, but not yet 'ready'

    await connect(connection, child, 'i1', location.origin);
    expect(statuses).toEqual(['connecting', 'connected']);
  });

  it('ignores a duplicate syn for the same pending/connected instance', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    synFromChild(child, 'i1', location.origin);
    child.postMessage.mockClear();
    synFromChild(child, 'i1', location.origin);
    expect(child.postMessage).not.toHaveBeenCalled();
  });

  it('a syn with a new instance tears down the old session and starts a fresh one', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    await connect(connection, child, 'i1', location.origin);
    expect(connection.status).toBe('connected');

    synFromChild(child, 'i2', location.origin); // the child reloaded
    expect(connection.status).toBe('connecting');
    expect(lastAck(child)?.instance).toBe('i2');

    const port2 = lastAckPort(child);
    port2?.postMessage({ rik: 1, type: 'ready' });
    await waitFor(() => connection.status === 'connected');
  });

  it('a new instance while still pending (never got to connected) stays connecting quietly', () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const statuses: string[] = [];
    connection.onStatusChange((s) => statuses.push(s));

    synFromChild(child, 'i1', location.origin); // ack sent, pending — never reaches 'ready'
    expect(connection.status).toBe('connecting');

    synFromChild(child, 'i2', location.origin); // a different instance replaces it, still pending
    expect(connection.status).toBe('connecting');
    expect(lastAck(child)?.instance).toBe('i2');
    // No spurious 'connecting' -> 'connecting' notification: status never actually changed.
    expect(statuses).toEqual(['connecting']);
  });

  it('targets the ack at the observed event.origin, not the configured wildcard', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: '*', unsafeAllowAnyOrigin: true });
    synFromChild(child, 'i1', 'https://specific.example');
    const call = [...child.postMessage.mock.calls].reverse().find((c) => c[0]?.type === 'ack');
    expect(call?.[1]).toBe('https://specific.example');
  });

  it('supports an opaque (sandboxed) child with origin: "null"', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: 'null' });
    synFromChild(child, 'i1', 'null');
    const call = [...child.postMessage.mock.calls].reverse().find((c) => c[0]?.type === 'ack');
    expect(call).toBeDefined();
    expect(call?.[1]).toBe('*'); // targeting 'null' restricts nothing beyond opacity itself
  });

  it('rejects a non-opaque syn when origin is configured as "null"', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, { origin: 'null' });
    synFromChild(child, 'i1', 'https://not-opaque.example');
    expect(lastAckPort(child)).toBeUndefined();
  });

  it('does not crash when contentWindow.postMessage throws while sending the ack', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    child.postMessage.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    expect(() => synFromChild(child, 'i1', location.origin)).not.toThrow();
  });
});

describe('size', () => {
  it('updates cachedSize and notifies listeners', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);

    const sizes: unknown[] = [];
    connection.onSize((s) => sizes.push(s));
    port.postMessage({ rik: 1, type: 'size', width: 320, height: 240 });
    await waitFor(() => connection.cachedSize !== undefined);

    expect(connection.cachedSize).toEqual({ width: 320, height: 240, loop: false });
    expect(sizes).toEqual([{ width: 320, height: 240, loop: false }]);
  });

  it('onSize fires immediately with the cached size', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'size', width: 10, height: 20, loop: true });
    await waitFor(() => connection.cachedSize !== undefined);

    const sizes: unknown[] = [];
    connection.onSize((s) => sizes.push(s));
    expect(sizes).toEqual([{ width: 10, height: 20, loop: true }]);
  });

  it('drops a malformed size message', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'size', width: -1, height: 20 });
    // Nothing to poll for since it's correctly a no-op; give delivery a moment anyway.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connection.cachedSize).toBeUndefined();
  });

  it('onSize/onStatusChange stop delivering after their unsubscribe is called', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const statuses: string[] = [];
    const sizes: unknown[] = [];
    const unsubscribeStatus = connection.onStatusChange((s) => statuses.push(s));
    const unsubscribeSize = connection.onSize((s) => sizes.push(s));
    unsubscribeStatus();
    unsubscribeSize();

    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'size', width: 1, height: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(statuses).toEqual(['connecting']); // only the immediate call on subscribe
    expect(sizes).toEqual([]);
  });
});

describe('bye', () => {
  it('moves back to connecting, clears the cached size, and resends syn', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'size', width: 1, height: 1 });
    await waitFor(() => connection.cachedSize !== undefined);

    child.postMessage.mockClear();
    port.postMessage({ rik: 1, type: 'bye' });
    await waitFor(() => connection.status === 'connecting');

    expect(connection.cachedSize).toBeUndefined();
    expect(child.postMessage).toHaveBeenCalledWith(
      { rik: 1, type: 'syn', versions: [1] },
      location.origin,
    );
  });

  it('a fresh syn for the same instance after bye is accepted (not treated as a duplicate)', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'bye' });
    await waitFor(() => connection.status === 'connecting');

    synFromChild(child, 'i1', location.origin);
    const newPort = lastAckPort(child);
    expect(newPort).toBeDefined();
    newPort?.postMessage({ rik: 1, type: 'ready' });
    await waitFor(() => connection.status === 'connected');
  });
});

describe('release and disposal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('defers teardown by one macrotask, so an immediate re-acquire reuses the connection', () => {
    const { iframe, child } = createIframe();
    const first = acquireParentConnection(iframe, {});
    first.release();
    child.postMessage.mockClear();

    const second = acquireParentConnection(iframe, {});
    expect(second).toBe(first);
    vi.advanceTimersByTime(0);
    expect(child.postMessage).not.toHaveBeenCalled(); // no bye: it was never disposed
  });

  it('disposes for real once the deferred teardown elapses, so a later acquire is fresh', () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    connection.release();
    vi.advanceTimersByTime(0);

    child.postMessage.mockClear();
    const fresh = acquireParentConnection(iframe, {});
    expect(fresh).not.toBe(connection);
    expect(child.postMessage).toHaveBeenCalledWith(
      { rik: 1, type: 'syn', versions: [1] },
      location.origin,
    );
  });

  it("a disposed connection's pending session sends bye to the child side", async () => {
    vi.useRealTimers();
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    synFromChild(child, 'i1', location.origin);
    const port = lastAckPort(child);
    expect(port).toBeDefined();

    let receivedBye = false;
    port?.addEventListener('message', (e) => {
      if ((e as MessageEvent).data?.type === 'bye') receivedBye = true;
    });
    port?.start();

    connection.release();
    await waitFor(() => receivedBye);
  });
});
