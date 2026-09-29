import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchConnectDeadline } from './connectDeadline';
import type { ConnectionStatus } from './parentConnection';

function fakeConnection(initial: ConnectionStatus = 'connecting') {
  const listeners = new Set<(status: ConnectionStatus) => void>();
  const connection = {
    status: initial,
    onStatusChange(callback: (status: ConnectionStatus) => void) {
      listeners.add(callback);
      callback(connection.status);
      return () => listeners.delete(callback);
    },
    set(status: ConnectionStatus) {
      connection.status = status;
      for (const listener of listeners) listener(status);
    },
    get listenerCount() {
      return listeners.size;
    },
  };
  return connection;
}

describe('watchConnectDeadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('times out after `ms` in connecting, and not once connected', () => {
    const iframe = document.createElement('iframe');
    const connection = fakeConnection();
    const onTimeout = vi.fn();
    watchConnectDeadline(iframe, connection, () => 100, onTimeout);
    vi.advanceTimersByTime(99);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledOnce();

    connection.set('connected');
    connection.set('connecting'); // a lost connection gets its full time again
    vi.advanceTimersByTime(50);
    connection.set('connected');
    vi.advanceTimersByTime(100);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('restarts on every load while connecting, and ignores loads once connected', () => {
    const iframe = document.createElement('iframe');
    const connection = fakeConnection();
    const onTimeout = vi.fn();
    watchConnectDeadline(iframe, connection, () => 100, onTimeout);
    vi.advanceTimersByTime(80);
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(80);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(onTimeout).toHaveBeenCalledOnce();

    connection.set('connected');
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1000);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('starts a lazy iframe’s wait at its load', () => {
    const iframe = document.createElement('iframe');
    iframe.loading = 'lazy';
    const onTimeout = vi.fn();
    watchConnectDeadline(iframe, fakeConnection(), () => 100, onTimeout);
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(100);
    expect(onTimeout).toHaveBeenCalledOnce();
  });

  it('never times out with Infinity', () => {
    const iframe = document.createElement('iframe');
    const onTimeout = vi.fn();
    watchConnectDeadline(iframe, fakeConnection(), () => Infinity, onTimeout);
    vi.advanceTimersByTime(1e9);
    expect(onTimeout).not.toHaveBeenCalled();
  });

  it('stops watching', () => {
    const iframe = document.createElement('iframe');
    const connection = fakeConnection();
    const onTimeout = vi.fn();
    const stop = watchConnectDeadline(iframe, connection, () => 100, onTimeout);
    stop();
    iframe.dispatchEvent(new Event('load'));
    vi.advanceTimersByTime(1000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(connection.listenerCount).toBe(0);
  });
});
