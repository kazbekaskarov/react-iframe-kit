import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeferredRpc } from './deferredRpc';
import { IframeKitError } from './errors';
import { createRemote, withOptions } from './remote';
import { QUEUE_LIMIT, type RpcHandle } from './rpc';

function fakeHandle() {
  const log: Array<[string, ...unknown[]]> = [];
  const calls: Array<{ method: string; args: unknown[]; options: unknown }> = [];
  const handle: RpcHandle = {
    remote: createRemote((method, args, options) => {
      calls.push({ method, args, options });
      log.push(['call', method, ...args]);
      return Promise.resolve(`${method}-result`);
    }),
    emit: (name, payload) => {
      log.push(['event', name, payload]);
    },
    on: () => () => {},
    release: () => {},
  };
  return { handle, log, calls };
}

const call = (rpc: DeferredRpc, name: string) =>
  rpc.remote[name] as (...a: unknown[]) => Promise<unknown>;

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('DeferredRpc', () => {
  it('forwards straight to an attached handle', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const { handle, log } = fakeHandle();
    rpc.attach(handle);
    await expect(call(rpc, 'x')(1)).resolves.toBe('x-result');
    rpc.emit('e', 2);
    expect(log).toEqual([
      ['call', 'x', 1],
      ['event', 'e', 2],
    ]);
  });

  it('keeps calls and events made before attach() in order, and flushes them on attach', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const first = call(rpc, 'a')();
    rpc.emit('between', 1);
    const second = call(rpc, 'b')();
    const { handle, log } = fakeHandle();
    rpc.attach(handle);
    await expect(first).resolves.toBe('a-result');
    await expect(second).resolves.toBe('b-result');
    expect(log).toEqual([
      ['call', 'a'],
      ['event', 'between', 1],
      ['call', 'b'],
    ]);
  });

  it('passes per-call options through, before and after attach', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const early = withOptions(call(rpc, 'a'), { timeout: 5 })();
    const { handle, calls } = fakeHandle();
    rpc.attach(handle);
    await early;
    await withOptions(call(rpc, 'b'), { timeout: 6 })();
    expect(calls).toEqual([
      { method: 'a', args: [], options: { timeout: 5 } },
      { method: 'b', args: [], options: { timeout: 6 } },
    ]);
  });

  it('attach(null) makes later calls wait again', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const { handle } = fakeHandle();
    rpc.attach(handle);
    rpc.attach(null);
    const promise = call(rpc, 'x')();
    const second = fakeHandle();
    rpc.attach(second.handle);
    await expect(promise).resolves.toBe('x-result');
    expect(second.log).toEqual([['call', 'x']]);
  });

  it('rejects a waiting call with RIK_TIMEOUT (phase: connect) after connectTimeout', async () => {
    vi.useFakeTimers();
    const rpc = new DeferredRpc(() => 500);
    const promise = call(rpc, 'x')();
    vi.advanceTimersByTime(500);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_TIMEOUT', phase: 'connect' });
    // It left the queue: attaching later doesn't run it.
    const { handle, log } = fakeHandle();
    rpc.attach(handle);
    expect(log).toEqual([]);
  });

  it('connectTimeout: Infinity waits indefinitely', async () => {
    vi.useFakeTimers();
    const rpc = new DeferredRpc(() => Number.POSITIVE_INFINITY);
    const promise = call(rpc, 'x')();
    vi.advanceTimersByTime(1e9);
    const { handle } = fakeHandle();
    rpc.attach(handle);
    await expect(promise).resolves.toBe('x-result');
  });

  it('aborting a waiting call removes it from the queue', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const controller = new AbortController();
    const promise = withOptions(call(rpc, 'x'), { signal: controller.signal })();
    const other = call(rpc, 'y')();
    controller.abort(new Error('cancelled'));
    await expect(promise).rejects.toThrow('cancelled');
    const { handle, log } = fakeHandle();
    rpc.attach(handle);
    await other;
    expect(log).toEqual([['call', 'y']]);
  });

  it('rejects immediately for an already-aborted signal', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const controller = new AbortController();
    controller.abort(new Error('already'));
    await expect(withOptions(call(rpc, 'x'), { signal: controller.signal })()).rejects.toThrow(
      'already',
    );
  });

  it('fail() rejects waiting and later calls with the error and drops events until attach()', async () => {
    const rpc = new DeferredRpc(() => 1000);
    const waiting = call(rpc, 'x')();
    const error = new IframeKitError('RIK_METHOD_CONFLICT', 'conflict');
    rpc.fail(error);
    await expect(waiting).rejects.toBe(error);
    await expect(call(rpc, 'y')()).rejects.toBe(error);
    rpc.emit('dropped');

    const { handle, log } = fakeHandle();
    rpc.attach(handle);
    await expect(call(rpc, 'z')()).resolves.toBe('z-result');
    expect(log).toEqual([['call', 'z']]);
  });

  it('dispose() rejects waiting and later calls with RIK_DESTROYED and drops events', async () => {
    const rpc = new DeferredRpc(() => 1000);
    rpc.emit('queued-then-dropped');
    const waiting = call(rpc, 'x')();
    rpc.dispose();
    await expect(waiting).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
    await expect(call(rpc, 'y')()).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
    expect(() => rpc.emit('ignored')).not.toThrow();
  });

  it('reopen() undoes dispose() (StrictMode remount)', async () => {
    const rpc = new DeferredRpc(() => 1000);
    rpc.dispose();
    rpc.reopen();
    const promise = call(rpc, 'x')();
    const { handle } = fakeHandle();
    rpc.attach(handle);
    await expect(promise).resolves.toBe('x-result');
  });

  it('caps the queue at QUEUE_LIMIT: calls reject, events are dropped with console.error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const rpc = new DeferredRpc(() => Number.POSITIVE_INFINITY);
    for (let i = 0; i < QUEUE_LIMIT; i++) rpc.emit('fill');
    await expect(call(rpc, 'x')()).rejects.toMatchObject({ code: 'RIK_QUEUE_OVERFLOW' });
    rpc.emit('one-too-many');
    expect(consoleError).toHaveBeenCalledTimes(1);
  });
});
