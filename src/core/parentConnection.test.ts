import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IframeKitError } from './errors';
import { acquireParentConnection, type ParentConnection } from './parentConnection';
import { RpcEngine } from './rpc';

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
  it('sends its prompt syn to any origin, even to a cross-origin iframe', () => {
    // It carries nothing, and the page's reply is checked. Aimed at the expected origin,
    // it would make the browser log an error while the iframe still holds its initial
    // about:blank. See docs/design.md → Handshake.
    const { iframe, child } = createIframe();
    iframe.src = 'https://widget.example.com/embed';
    acquireParentConnection(iframe, { origin: 'https://widget.example.com' });
    expect(child.postMessage).toHaveBeenCalledWith({ rik: 1, type: 'syn', versions: [1] }, '*');
  });

  it('sends a syn immediately on first acquire', () => {
    const { iframe, child } = createIframe();
    acquireParentConnection(iframe, {});
    expect(child.postMessage).toHaveBeenCalledWith({ rik: 1, type: 'syn', versions: [1] }, '*');
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
    expect(child.postMessage).toHaveBeenCalledWith({ rik: 1, type: 'syn', versions: [1] }, '*');
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

describe('inert', () => {
  function collectInert(port: MessagePort): boolean[] {
    const states: boolean[] = [];
    port.onmessage = (event) => {
      if (event.data?.type === 'inert') states.push(event.data.inert);
    };
    return states;
  }

  it('tells the child whether any user wants it inert, on changes only', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    const states = collectInert(port);
    const first = {};
    const second = {};

    connection.setInert(first, true);
    connection.setInert(second, true); // still inert: nothing new to say
    connection.setInert(first, false); // the second user still wants it
    connection.setInert(second, false);
    await waitFor(() => states.length === 2);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(states).toEqual([true, false]);
  });

  it('sends nothing before connecting, then tells the new session', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    connection.setInert({}, true); // still connecting: kept for the session
    synFromChild(child, 'i1', location.origin);
    const port = lastAckPort(child);
    if (!port) throw new Error('no ack was sent');
    const states = collectInert(port);
    port.postMessage({ rik: 1, type: 'ready' });
    await waitFor(() => states.length === 1);
    expect(states).toEqual([true]);
  });

  it('ignores an inert message from the child', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    port.postMessage({ rik: 1, type: 'inert', inert: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(connection.status).toBe('connected');
  });
});

describe('title', () => {
  it('notifies listeners of each new title, once per change', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    const titles: Array<string | undefined> = [];
    const off = connection.onTitle((title) => titles.push(title));
    expect(titles).toEqual([]); // nothing cached yet

    port.postMessage({ rik: 1, type: 'title', title: 'Checkout' });
    port.postMessage({ rik: 1, type: 'title', title: 'Checkout' });
    port.postMessage({ rik: 1, type: 'title', title: 'Payment' });
    await waitFor(() => titles.length === 2);
    expect(titles).toEqual(['Checkout', 'Payment']);

    off();
    port.postMessage({ rik: 1, type: 'title', title: 'Done' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles).toEqual(['Checkout', 'Payment']);
  });

  it('onTitle fires immediately with the cached title', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    const first: Array<string | undefined> = [];
    connection.onTitle((title) => first.push(title));
    port.postMessage({ rik: 1, type: 'title', title: 'Checkout' });
    await waitFor(() => first.length === 1);

    const later: Array<string | undefined> = [];
    connection.onTitle((title) => later.push(title));
    expect(later).toEqual(['Checkout']);
  });

  it('forgets the title when the session ends', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    const titles: Array<string | undefined> = [];
    connection.onTitle((title) => titles.push(title));
    port.postMessage({ rik: 1, type: 'title', title: 'Checkout' });
    await waitFor(() => titles.length === 1);

    port.postMessage({ rik: 1, type: 'bye' });
    await waitFor(() => titles.length === 2);
    expect(titles).toEqual(['Checkout', undefined]);
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
    expect(child.postMessage).toHaveBeenCalledWith({ rik: 1, type: 'syn', versions: [1] }, '*');
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
    expect(child.postMessage).toHaveBeenCalledWith({ rik: 1, type: 'syn', versions: [1] }, '*');
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

describe('rpc', () => {
  /** Collects every message the parent sends to the child over `port`. */
  function inbox(port: MessagePort): Array<Record<string, unknown>> {
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();
    return received;
  }

  it('queues a call made while connecting, sends it once ready, and resolves with the result', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const { remote } = connection.acquireRpc({}, {}, RpcEngine);
    const promise = remote['greet']?.('ann');

    const port = await connect(connection, child, 'i1', location.origin);
    const received = inbox(port);
    await waitFor(() => received.some((m) => m['type'] === 'call'));
    const call = received.find((m) => m['type'] === 'call');
    expect(call).toMatchObject({ method: 'greet', args: ['ann'] });

    port.postMessage({ rik: 1, type: 'result', id: call?.['id'], ok: true, value: 'hi ann' });
    await expect(promise).resolves.toBe('hi ann');
  });

  it('answers an incoming call from the child with its local method', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    connection.acquireRpc(
      {},
      { methods: { add: (a, b) => (a as number) + (b as number) } },
      RpcEngine,
    );
    const port = await connect(connection, child, 'i1', location.origin);
    const received = inbox(port);

    port.postMessage({ rik: 1, type: 'call', id: 'c1', method: 'add', args: [2, 3] });
    await waitFor(() => received.some((m) => m['type'] === 'result'));
    expect(received.find((m) => m['type'] === 'result')).toMatchObject({
      id: 'c1',
      ok: true,
      value: 5,
    });
  });

  it('delivers events both ways', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const { emit, on } = connection.acquireRpc({}, {}, RpcEngine);
    const handler = vi.fn();
    on('submitted', handler);
    const port = await connect(connection, child, 'i1', location.origin);
    const received = inbox(port);

    port.postMessage({ rik: 1, type: 'event', name: 'submitted', payload: { id: 'x' } });
    await waitFor(() => handler.mock.calls.length > 0);
    expect(handler).toHaveBeenCalledWith({ id: 'x' });

    emit('themeChanged', 'dark');
    await waitFor(() => received.some((m) => m['type'] === 'event'));
    expect(received.find((m) => m['type'] === 'event')).toMatchObject({
      name: 'themeChanged',
      payload: 'dark',
    });
  });

  it('bye rejects a pending call with RIK_CONNECTION_LOST', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const { remote } = connection.acquireRpc({}, {}, RpcEngine);
    const port = await connect(connection, child, 'i1', location.origin);
    const promise = remote['slow']?.();

    port.postMessage({ rik: 1, type: 'bye' });
    await expect(promise).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });
  });

  it('a reloaded child (new instance) rejects a pending call with RIK_CONNECTION_LOST', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const { remote } = connection.acquireRpc({}, {}, RpcEngine);
    await connect(connection, child, 'i1', location.origin);
    const promise = remote['slow']?.();

    synFromChild(child, 'i2', location.origin);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });
  });

  it('debug: true also logs RPC traffic', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, { debug: true });
    const { emit } = connection.acquireRpc({}, {}, RpcEngine);
    await connect(connection, child, 'i1', location.origin);
    debug.mockClear();
    emit('ping');
    expect(debug).toHaveBeenCalledWith(
      'react-iframe-kit → event ping',
      expect.objectContaining({ type: 'event', name: 'ping' }),
    );
  });
});

describe('port message edge cases', () => {
  it('ignores a duplicate ready once the session is connected', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const { remote } = connection.acquireRpc({}, {}, RpcEngine);
    const port = await connect(connection, child, 'i1', location.origin);
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();

    port.postMessage({ rik: 1, type: 'ready' });
    // Still wired to the original port: a call made now reaches the child.
    void remote['x']?.();
    await waitFor(() => received.some((m) => m['type'] === 'call'));
    expect(connection.status).toBe('connected');
  });
});

describe('lazy RPC engine', () => {
  it('answers a call with RIK_METHOD_NOT_FOUND when nothing on this side uses RPC', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    const port = await connect(connection, child, 'i1', location.origin);
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();

    port.postMessage({ rik: 1, type: 'result', id: 'stray', ok: true }); // ignored
    port.postMessage({ rik: 1, type: 'event', name: 'x' }); // ignored
    port.postMessage({ rik: 1, type: 'call', id: 'c1', method: 'nope', args: [] });
    await waitFor(() => received.length > 0);
    expect(received).toEqual([
      {
        rik: 1,
        type: 'result',
        id: 'c1',
        ok: false,
        error: {
          name: 'IframeKitError',
          message: 'no method named "nope"',
          code: 'RIK_METHOD_NOT_FOUND',
        },
      },
    ]);
  });

  it('an engine created after connecting starts out connected, with debug carried over', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, { debug: true });
    const port = await connect(connection, child, 'i1', location.origin);
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();

    debug.mockClear();
    const { emit } = connection.acquireRpc({}, {}, RpcEngine);
    emit('late');
    await waitFor(() => received.some((m) => m['type'] === 'event'));
    expect(debug).toHaveBeenCalledWith(
      'react-iframe-kit → event late',
      expect.objectContaining({ name: 'late' }),
    );
  });

  it('reuses one engine for every RPC acquirer on the connection', async () => {
    const { iframe, child } = createIframe();
    const connection = acquireParentConnection(iframe, {});
    connection.acquireRpc({}, { methods: { a: () => 'a' } }, RpcEngine);
    connection.acquireRpc({}, { methods: { b: () => 'b' } }, RpcEngine);
    const port = await connect(connection, child, 'i1', location.origin);
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();

    port.postMessage({ rik: 1, type: 'call', id: 'c1', method: 'a', args: [] });
    port.postMessage({ rik: 1, type: 'call', id: 'c2', method: 'b', args: [] });
    await waitFor(() => received.length === 2);
    expect(received.map((m) => m['value'])).toEqual(['a', 'b']);
  });
});
