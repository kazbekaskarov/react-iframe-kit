import { afterEach, describe, expect, it, vi } from 'vitest';
import { logProtocolMessage } from '../core/debugLog';
import { connectReduxDevTools } from './redux';

afterEach(() => {
  delete (window as { __REDUX_DEVTOOLS_EXTENSION__?: unknown }).__REDUX_DEVTOOLS_EXTENSION__;
});

function fakeExtension() {
  const connection = { init: vi.fn(), send: vi.fn() };
  const extension = { connect: vi.fn(() => connection) };
  Object.assign(window, { __REDUX_DEVTOOLS_EXTENSION__: extension });
  return { extension, connection };
}

describe('connectReduxDevTools', () => {
  it('does nothing without the extension', () => {
    const stop = connectReduxDevTools();
    expect(() => logProtocolMessage(false, '→', { rik: 1, type: 'ready' })).not.toThrow();
    stop();
  });

  it('sends each message as an action named by its summary, until stopped', () => {
    const { extension, connection } = fakeExtension();
    const stop = connectReduxDevTools({ name: 'widget', maxAge: 200 });
    expect(extension.connect).toHaveBeenCalledWith({ name: 'widget', maxAge: 200 });
    expect(connection.init).toHaveBeenCalledWith({ sent: 0, received: 0 });

    const call = {
      rik: 1,
      type: 'call',
      id: 'mfz3k2a0q9x7c1',
      method: 'getUser',
      args: [1] as unknown[],
    } as const;
    const result = { rik: 1, type: 'result', id: 'mfz3k2a0q9x7c1', ok: true, value: 1 } as const;
    logProtocolMessage(false, '→', call);
    logProtocolMessage(false, '←', result, 'getUser, 12 ms');
    expect(connection.send.mock.calls).toEqual([
      [
        { type: '→ call getUser #q9x7c1', message: call },
        { sent: 1, received: 0, last: call },
      ],
      [
        { type: '← result #q9x7c1 ok (getUser, 12 ms)', message: result },
        { sent: 1, received: 1, last: result },
      ],
    ]);

    stop();
    logProtocolMessage(false, '→', call);
    expect(connection.send).toHaveBeenCalledTimes(2);
  });

  it('uses the default name and leaves maxAge to the extension', () => {
    const { extension } = fakeExtension();
    connectReduxDevTools()();
    expect(extension.connect).toHaveBeenCalledWith({ name: 'react-iframe-kit' });
  });
});
