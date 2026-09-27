import { afterEach, describe, expect, it, vi } from 'vitest';
import { IframeKitError, RemoteError } from './errors';
import type { CallMessage, EventMessage, ResultMessage } from './protocol';
import { type RemoteMethod, withOptions } from './remote';
import { DEFAULT_CONNECT_TIMEOUT, DEFAULT_TIMEOUT, QUEUE_LIMIT, RpcEngine } from './rpc';
import { transfer } from './transfer';

type Sent = CallMessage | ResultMessage | EventMessage;

function harness() {
  const sent: Array<{ message: Sent; transferables?: Transferable[] | undefined }> = [];
  const send = vi.fn((message: Sent, transferables?: Transferable[]) => {
    sent.push({ message, transferables });
  });
  const engine = new RpcEngine();
  return { engine, send, sent };
}

// `remote`'s index signature is `RemoteMethod | undefined` under
// noUncheckedIndexedAccess, even though the Proxy always returns a function; this
// keeps call sites free of `?.` noise.
function call(remote: Record<string, RemoteMethod>, name: string): RemoteMethod {
  const fn = remote[name];
  if (!fn) throw new Error(`test setup: remote.${name} should always be a function`);
  return fn;
}

function lastCall(sent: ReturnType<typeof harness>['sent']): CallMessage {
  const found = [...sent].reverse().find((s) => s.message.type === 'call');
  if (!found) throw new Error('no call was sent');
  return found.message as CallMessage;
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

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('debug logging', () => {
  it('setDebug(true) logs outgoing and incoming traffic; false leaves it off', () => {
    const debugLog = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});

    void call(remote, 'x')();
    expect(debugLog).not.toHaveBeenCalled(); // debug is off by default

    engine.setDebug(true);
    void call(remote, 'y')();
    expect(debugLog).toHaveBeenCalledWith(
      'react-iframe-kit →',
      expect.objectContaining({ method: 'y' }),
    );

    debugLog.mockClear();
    const id = lastCall(sent).id;
    engine.handleResult({ rik: 1, type: 'result', id, ok: true, value: 1 });
    expect(debugLog).toHaveBeenCalledWith('react-iframe-kit ←', expect.objectContaining({ id }));

    debugLog.mockClear();
    engine.setDebug(false); // merges upward only: does not turn logging back off
    engine.handleEvent({ rik: 1, type: 'event', name: 'z', payload: undefined });
    expect(debugLog).toHaveBeenCalledWith(
      'react-iframe-kit ←',
      expect.objectContaining({ name: 'z' }),
    );

    debugLog.mockClear();
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'missing', args: [] });
    expect(debugLog).toHaveBeenCalledWith(
      'react-iframe-kit ←',
      expect.objectContaining({ method: 'missing' }),
    );
  });
});

describe('acquire', () => {
  it('registers methods and merges into a shared dispatch table', () => {
    const { engine } = harness();
    const a = {};
    const b = {};
    engine.acquire(a, { methods: { greet: () => 'hi' } });
    engine.acquire(b, { methods: { farewell: () => 'bye' } });
    expect(engine['methods'].has('greet')).toBe(true);
    expect(engine['methods'].has('farewell')).toBe(true);
  });

  it('throws RIK_METHOD_CONFLICT when two different users register the same name', () => {
    const { engine } = harness();
    engine.acquire({}, { methods: { x: () => 1 } });
    expectCode(() => engine.acquire({}, { methods: { x: () => 2 } }), 'RIK_METHOD_CONFLICT');
  });

  it('does not conflict when the same user re-registers the same name', () => {
    const { engine } = harness();
    const user = {};
    engine.acquire(user, { methods: { x: () => 1 } });
    expect(() => engine.acquire(user, { methods: { x: () => 2 } })).not.toThrow();
  });

  it('rejects "then" and "toJSON" as method names, registering nothing from that call', () => {
    const { engine } = harness();
    const methods = {
      ok: () => 1,
      // biome-ignore lint/suspicious/noThenProperty: exercising the reserved-name rejection itself
      then: () => 2,
    };
    expectCode(() => engine.acquire({}, { methods }), 'RIK_INVALID_OPTIONS');
    expect(engine['methods'].has('ok')).toBe(false);
  });

  it('skips a non-function value under a method name', () => {
    const { engine } = harness();
    engine.acquire({}, { methods: { x: 42 as unknown as () => unknown } });
    expect(engine['methods'].has('x')).toBe(false);
  });
});

describe('outgoing calls', () => {
  it('queues a call while disconnected and sends it once connected', () => {
    const { engine, send, sent } = harness();
    const { remote } = engine.acquire({}, {});
    const promise = call(remote, 'greet')('world');
    expect(sent).toHaveLength(0);

    engine.connected(send);
    expect(lastCall(sent)).toMatchObject({ type: 'call', method: 'greet', args: ['world'] });
    void promise;
  });

  it('sends immediately while already connected', () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    void call(remote, 'greet')();
    expect(sent).toHaveLength(1);
  });

  it('resolves when a matching result arrives', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    const promise = call(remote, 'getUser')();
    const { id } = lastCall(sent);
    engine.handleResult({ rik: 1, type: 'result', id, ok: true, value: { name: 'Ada' } });
    await expect(promise).resolves.toEqual({ name: 'Ada' });
  });

  it('rejects with RemoteError when the result is an error', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    const promise = call(remote, 'fail')();
    const { id } = lastCall(sent);
    engine.handleResult({
      rik: 1,
      type: 'result',
      id,
      ok: false,
      error: { name: 'ValidationError', message: 'bad input', code: 'E_BAD' },
    });
    await expect(promise).rejects.toBeInstanceOf(RemoteError);
    await promise.catch((error: RemoteError) => {
      expect(error.message).toBe('bad input');
      expect(error.cause).toEqual({ name: 'ValidationError', message: 'bad input', code: 'E_BAD' });
    });
  });

  it('ignores a result for an unknown id', () => {
    const { engine } = harness();
    expect(() =>
      engine.handleResult({ rik: 1, type: 'result', id: 'nope', ok: true, value: 1 }),
    ).not.toThrow();
  });

  it('rejects with RIK_TIMEOUT (phase: response) if no result arrives in time', async () => {
    vi.useFakeTimers();
    const { engine, send } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, { timeout: 1_000 });
    const promise = call(remote, 'slow')();
    vi.advanceTimersByTime(1_000);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'response' });
  });

  it('timeout: Infinity on a sent call never times out', async () => {
    vi.useFakeTimers();
    const { engine, send } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, { timeout: Number.POSITIVE_INFINITY });
    const promise = call(remote, 'x')();
    vi.advanceTimersByTime(1e9);
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('rejects with RIK_TIMEOUT (phase: connect) if still queued past connectTimeout', async () => {
    vi.useFakeTimers();
    const { engine } = harness();
    const { remote } = engine.acquire({}, { connectTimeout: 500 });
    const promise = call(remote, 'x')();
    vi.advanceTimersByTime(500);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'connect' });
  });

  it('connectTimeout: Infinity never times out while queued', async () => {
    vi.useFakeTimers();
    const { engine } = harness();
    const { remote } = engine.acquire({}, { connectTimeout: Number.POSITIVE_INFINITY });
    const promise = call(remote, 'x')();
    vi.advanceTimersByTime(1e9);
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it('the response timeout clock starts at send, not at the original call', async () => {
    vi.useFakeTimers();
    const { engine, send } = harness();
    const { remote } = engine.acquire({}, { connectTimeout: 10_000, timeout: 1_000 });
    const promise = call(remote, 'x')();
    vi.advanceTimersByTime(900); // most of connectTimeout elapses while still queued
    engine.connected(send);
    vi.advanceTimersByTime(900); // would have failed already if the response timer started at call()
    expect(send).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(200); // now past 1_000 ms since it was actually sent
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'response' });
  });

  it('withOptions overrides the timeout for a single call', async () => {
    vi.useFakeTimers();
    const { engine, send } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, { timeout: 10_000 });
    const promise = withOptions(call(remote, 'x'), { timeout: 50 })();
    vi.advanceTimersByTime(50);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT' });
  });

  it('withOptions throws RIK_INVALID_OPTIONS for a function not from `remote`', () => {
    expectCode(() => withOptions(() => Promise.resolve(), {}), 'RIK_INVALID_OPTIONS');
  });

  it('rejects immediately for an already-aborted signal, without queueing or sending', () => {
    const { engine, send, sent } = harness();
    const { remote } = engine.acquire({}, {});
    const controller = new AbortController();
    controller.abort(new Error('nope'));
    const promise = withOptions(call(remote, 'x'), {
      signal: controller.signal,
    })();
    engine.connected(send);
    expect(sent).toHaveLength(0);
    return expect(promise).rejects.toThrow('nope');
  });

  it('aborting a queued call removes it from the queue', async () => {
    const { engine, send, sent } = harness();
    const { remote } = engine.acquire({}, {});
    const controller = new AbortController();
    const promise = withOptions(call(remote, 'x'), {
      signal: controller.signal,
    })();
    controller.abort(new Error('cancelled'));
    await expect(promise).rejects.toThrow('cancelled');
    engine.connected(send);
    expect(sent).toHaveLength(0);
  });

  it('aborting a queued call after its connectTimeout already fired is a harmless no-op', async () => {
    vi.useFakeTimers();
    const { engine } = harness();
    const { remote } = engine.acquire({}, { connectTimeout: 500 });
    const controller = new AbortController();
    const promise = withOptions(call(remote, 'x'), { signal: controller.signal })();
    promise.catch(() => {}); // the connect-timeout rejection is asserted below; avoid an unhandled rejection
    vi.advanceTimersByTime(500);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'connect' });

    expect(() => controller.abort(new Error('too late'))).not.toThrow();
  });

  it('aborting a sent (pending) call rejects locally and ignores a later result', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    const controller = new AbortController();
    const promise = withOptions(call(remote, 'x'), {
      signal: controller.signal,
    })();
    const { id } = lastCall(sent);
    controller.abort(new Error('too late'));
    await expect(promise).rejects.toThrow('too late');
    // The late result must not throw or resolve the (already-settled) promise again.
    expect(() =>
      engine.handleResult({ rik: 1, type: 'result', id, ok: true, value: 'ignored' }),
    ).not.toThrow();
  });

  it('a queued call with a signal sends normally once connected, and can still be aborted afterwards', async () => {
    const { engine, send, sent } = harness();
    const { remote } = engine.acquire({}, {});
    const controller = new AbortController();
    const promise = withOptions(call(remote, 'x'), { signal: controller.signal })();
    engine.connected(send);
    expect(lastCall(sent)).toMatchObject({ method: 'x' });

    controller.abort(new Error('aborted after send'));
    await expect(promise).rejects.toThrow('aborted after send');
  });

  it('a pending call bound to a (never-aborted) signal still times out normally', async () => {
    vi.useFakeTimers();
    const { engine, send } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, { timeout: 1_000 });
    const controller = new AbortController();
    const promise = withOptions(call(remote, 'x'), { signal: controller.signal })();
    vi.advanceTimersByTime(1_000);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'response' });
  });

  it('rejects with RIK_QUEUE_OVERFLOW past 1,000 queued messages', async () => {
    const { engine } = harness();
    const { remote } = engine.acquire({}, {});
    for (let i = 0; i < QUEUE_LIMIT; i++) call(remote, 'x')()?.catch(() => {});
    await expect(call(remote, 'x')()).rejects.toMatchObject({ code: 'RIK_QUEUE_OVERFLOW' });
  });

  it('rejects with RIK_DATA_CLONE when the call cannot be sent, and keeps the connection usable', async () => {
    const { engine } = harness();
    const send = vi.fn(() => {
      throw new DOMException('nope', 'DataCloneError');
    });
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    await expect(call(remote, 'x')()).rejects.toMatchObject({ code: 'RIK_DATA_CLONE' });
  });

  it('sends a transfer()-wrapped argument via the transferables list', () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    const buffer = new ArrayBuffer(8);
    void call(remote, 'x')(transfer(buffer, [buffer]));
    expect(sent[0]?.message).toMatchObject({ args: [buffer] });
    expect(sent[0]?.transferables).toEqual([buffer]);
  });

  it('exposes the documented default timeouts', () => {
    expect(DEFAULT_TIMEOUT).toBe(10_000);
    expect(DEFAULT_CONNECT_TIMEOUT).toBe(30_000);
  });
});

describe('connection loss and release', () => {
  it('rejects pending (sent) calls with RIK_CONNECTION_LOST on disconnect, but leaves queued calls queued', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { remote } = engine.acquire({}, {});
    const sentPromise = call(remote, 'sent')();
    lastCall(sent);

    engine.disconnected();
    const queuedPromise = call(remote, 'queued')();

    await expect(sentPromise).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });

    // The queued one survives and sends on the next connect.
    send.mockClear();
    engine.connected(send);
    expect(lastCall(sent)).toMatchObject({ method: 'queued' });
    void queuedPromise;
  });

  it('release() rejects only that user’s pending call, leaving the other user’s pending call to resolve normally', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const a = engine.acquire({}, {});
    const b = engine.acquire({}, {});
    const aPending = call(a.remote, 'x')();
    const bPending = call(b.remote, 'x')();
    const bId = lastCall(sent).id;

    a.release();
    await expect(aPending).rejects.toMatchObject({ code: 'RIK_DESTROYED' });

    engine.handleResult({ rik: 1, type: 'result', id: bId, ok: true, value: 'still alive' });
    await expect(bPending).resolves.toBe('still alive');
  });

  it('release() rejects only that user’s queued call, leaving the other user’s queued call to send later', async () => {
    const { engine, send, sent } = harness();
    const a = engine.acquire({}, {});
    const b = engine.acquire({}, {});
    const aQueued = call(a.remote, 'y')();
    const bQueued = call(b.remote, 'y')();
    a.release();
    await expect(aQueued).rejects.toMatchObject({ code: 'RIK_DESTROYED' });

    engine.connected(send);
    expect(sent).toHaveLength(1);
    expect(lastCall(sent)).toMatchObject({ method: 'y' });
    void bQueued;
  });

  it('release() silently drops that user’s queued events, leaving another user’s queued event to send later', () => {
    const { engine, send, sent } = harness();
    const a = engine.acquire({}, {});
    const b = engine.acquire({}, {});
    a.emit('fromA');
    b.emit('fromB');

    a.release();
    engine.connected(send);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.message).toMatchObject({ type: 'event', name: 'fromB' });
  });

  it('release() unregisters only that user’s methods and event handlers', () => {
    const { engine } = harness();
    const a = {};
    const b = {};
    engine.acquire(a, { methods: { onlyA: () => 1 } });
    engine.acquire(b, { methods: { onlyB: () => 2 } });
    const bHandler = vi.fn();
    engine.onEvent(a, 'shared', vi.fn());
    engine.onEvent(b, 'shared', bHandler);

    engine.release(a);

    expect(engine['methods'].has('onlyA')).toBe(false);
    expect(engine['methods'].has('onlyB')).toBe(true);
    engine.handleEvent({ rik: 1, type: 'event', name: 'shared', payload: undefined });
    expect(bHandler).toHaveBeenCalledTimes(1); // only b's handler remains
  });

  it('a call from a stale remote after release() falls back to the default timeouts', () => {
    vi.useFakeTimers();
    const { engine } = harness();
    const user = {};
    const { remote, release } = engine.acquire(user, { connectTimeout: 5 }); // a short custom default
    release();

    const promise = call(remote, 'x')(); // called through the now-stale remote
    vi.advanceTimersByTime(5); // the released user's short connectTimeout must NOT apply
    let settled = false;
    promise.then(
      () => (settled = true),
      () => (settled = true),
    );
    expect(settled).toBe(false); // still queued: falls back to the (much longer) DEFAULT_CONNECT_TIMEOUT
  });
});

describe('incoming calls', () => {
  it('runs a registered method and sends the result', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    engine.acquire(
      {},
      { methods: { add: (...args: unknown[]) => (args[0] as number) + (args[1] as number) } },
    );
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'add', args: [2, 3] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ type: 'result', id: 'c1', ok: true, value: 5 });
  });

  it('awaits an async method before sending the result', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    engine.acquire({}, { methods: { greet: async () => 'hi' } });
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'greet', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ ok: true, value: 'hi' });
  });

  it('calls the method with `this` undefined', async () => {
    const { engine, send } = harness();
    engine.connected(send);
    let observedThis: unknown = 'not yet set';
    engine.acquire(
      {},
      {
        methods: {
          check() {
            observedThis = this;
          },
        },
      },
    );
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'check', args: [] });
    await vi.waitFor(() => expect(observedThis).toBeUndefined());
  });

  it('responds RIK_METHOD_NOT_FOUND for an unregistered method', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'missing', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ ok: false, error: { code: 'RIK_METHOD_NOT_FOUND' } });
  });

  it('responds RIK_METHOD_NOT_FOUND for inherited names like "constructor"', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'constructor', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ ok: false, error: { code: 'RIK_METHOD_NOT_FOUND' } });
  });

  it('serializes a thrown error into the result', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    engine.acquire(
      {},
      {
        methods: {
          fail() {
            throw new TypeError('boom');
          },
        },
      },
    );
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'fail', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({
      ok: false,
      error: { name: 'TypeError', message: 'boom' },
    });
  });

  it('falls back to RIK_DATA_CLONE when the return value cannot be cloned', async () => {
    const sent: Array<{ message: Sent }> = [];
    let calls = 0;
    const send = vi.fn((message: Sent) => {
      calls++;
      if (calls === 1) throw new DOMException('nope', 'DataCloneError');
      sent.push({ message });
    });
    const engine = new RpcEngine();
    engine.connected(send);
    engine.acquire({}, { methods: { fn: () => ({ cannotClone: () => {} }) } });
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'fn', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ ok: false, error: { code: 'RIK_DATA_CLONE' } });
  });

  it("retries with a minimal error when the thrown error's own data cannot be cloned", async () => {
    const sent: Array<{ message: Sent }> = [];
    let calls = 0;
    const send = vi.fn((message: Sent) => {
      calls++;
      if (calls === 1) throw new DOMException('nope', 'DataCloneError');
      sent.push({ message });
    });
    const engine = new RpcEngine();
    engine.connected(send);
    engine.acquire(
      {},
      {
        methods: {
          fail() {
            const error = new Error('boom');
            (error as Error & { data: unknown }).data = { fn: () => {} };
            throw error;
          },
        },
      },
    );
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'fail', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    const message = sent[0]?.message as {
      error: { name: string; message: string; data?: unknown };
    };
    expect(message).toMatchObject({ ok: false, error: { name: 'Error', message: 'boom' } });
    expect(message.error.data).toBeUndefined();
  });

  it('the minimal fallback error keeps `code` when the original error had one', async () => {
    const sent: Array<{ message: Sent }> = [];
    let calls = 0;
    const send = vi.fn((message: Sent) => {
      calls++;
      if (calls === 1) throw new DOMException('nope', 'DataCloneError');
      sent.push({ message });
    });
    const engine = new RpcEngine();
    engine.connected(send);
    engine.acquire(
      {},
      {
        methods: {
          fail() {
            const error = new Error('boom') as Error & { code: string; data: unknown };
            error.code = 'E_BOOM';
            error.data = { fn: () => {} };
            throw error;
          },
        },
      },
    );
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'fail', args: [] });
    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]?.message).toMatchObject({ ok: false, error: { code: 'E_BOOM' } });
  });

  it('does not send a result if the connection drops while the method is running', async () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    let resolveMethod!: () => void;
    engine.acquire({}, { methods: { slow: () => new Promise<void>((r) => (resolveMethod = r)) } });
    engine.handleCall({ rik: 1, type: 'call', id: 'c1', method: 'slow', args: [] });
    engine.disconnected();
    resolveMethod();
    await Promise.resolve();
    await Promise.resolve();
    expect(sent).toHaveLength(0);
  });
});

describe('events', () => {
  it('queues an emit while disconnected and sends it on connect', () => {
    const { engine, send, sent } = harness();
    const { emit } = engine.acquire({}, {});
    emit('greeted', { id: 1 });
    expect(sent).toHaveLength(0);
    engine.connected(send);
    expect(sent[0]?.message).toMatchObject({ type: 'event', name: 'greeted', payload: { id: 1 } });
  });

  it('sends an emit immediately while connected', () => {
    const { engine, send, sent } = harness();
    engine.connected(send);
    const { emit } = engine.acquire({}, {});
    emit('x');
    expect(sent).toHaveLength(1);
  });

  it('dispatches an incoming event to every registered handler, in order', () => {
    const { engine } = harness();
    const order: string[] = [];
    engine.onEvent({}, 'greeted', () => order.push('first'));
    engine.onEvent({}, 'greeted', () => order.push('second'));
    engine.handleEvent({ rik: 1, type: 'event', name: 'greeted', payload: undefined });
    expect(order).toEqual(['first', 'second']);
  });

  it('a throwing handler does not stop the others (reported via console.error where reportError is unavailable)', () => {
    expect(typeof reportError).toBe('undefined'); // this environment, confirmed
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = harness();
    const order: string[] = [];
    engine.onEvent({}, 'x', () => {
      throw new Error('boom');
    });
    engine.onEvent({}, 'x', () => order.push('second'));
    engine.handleEvent({ rik: 1, type: 'event', name: 'x', payload: undefined });
    expect(order).toEqual(['second']);
    expect(consoleError).toHaveBeenCalledWith(new Error('boom'));
  });

  it('uses reportError instead of console.error when it is available', () => {
    vi.stubGlobal('reportError', vi.fn());
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = harness();
    engine.onEvent({}, 'x', () => {
      throw new Error('boom');
    });
    engine.handleEvent({ rik: 1, type: 'event', name: 'x', payload: undefined });
    expect(reportError).toHaveBeenCalledWith(new Error('boom'));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it('drops an event with no registered handler', () => {
    const { engine } = harness();
    expect(() =>
      engine.handleEvent({ rik: 1, type: 'event', name: 'unheard', payload: undefined }),
    ).not.toThrow();
  });

  it('an unsubscribed handler no longer receives events', () => {
    const { engine } = harness();
    const handler = vi.fn();
    const off = engine.onEvent({}, 'x', handler);
    off();
    engine.handleEvent({ rik: 1, type: 'event', name: 'x', payload: undefined });
    expect(handler).not.toHaveBeenCalled();
  });

  it('acquire()’s `on` registers a handler the same way as onEvent', () => {
    const { engine } = harness();
    const handler = vi.fn();
    const { on } = engine.acquire({}, {});
    on('x', handler);
    engine.handleEvent({ rik: 1, type: 'event', name: 'x', payload: 'p' });
    expect(handler).toHaveBeenCalledWith('p');
  });

  it('drops an unsendable payload with console.error instead of throwing', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = harness();
    const send = vi.fn(() => {
      throw new DOMException('nope', 'DataCloneError');
    });
    engine.connected(send);
    const { emit } = engine.acquire({}, {});
    expect(() => emit('x', () => {})).not.toThrow();
    expect(consoleError).toHaveBeenCalled();
  });

  it('drops a queued event past the queue limit with console.error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { engine } = harness();
    const { emit, remote } = engine.acquire({}, {});
    for (let i = 0; i < QUEUE_LIMIT; i++) call(remote, 'x')()?.catch(() => {});
    emit('overflow');
    expect(consoleError).toHaveBeenCalled();
  });
});
