import { afterEach, describe, expect, it, vi } from 'vitest';
import { logProtocolMessage } from './debugLog';
import type { PortMessage, WindowMessage } from './protocol';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logProtocolMessage', () => {
  it('logs a summary, then the message itself', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logProtocolMessage(true, '→', { rik: 1, type: 'syn', versions: [1] });
    expect(debug).toHaveBeenCalledWith('react-iframe-kit → syn', {
      rik: 1,
      type: 'syn',
      versions: [1],
    });
  });

  it('does nothing when disabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logProtocolMessage(false, '←', { rik: 1, type: 'ready' });
    expect(debug).not.toHaveBeenCalled();
  });

  it.each<[WindowMessage | PortMessage, string]>([
    [{ rik: 1, type: 'ack', session: 's', instance: 'i', version: 1 }, 'ack'],
    [{ rik: 1, type: 'ready' }, 'ready'],
    [{ rik: 1, type: 'bye' }, 'bye'],
    [{ rik: 1, type: 'size', width: 320, height: 480 }, 'size 320×480'],
    [{ rik: 1, type: 'size', width: 320, height: 480, loop: true }, 'size 320×480 loop'],
    [
      { rik: 1, type: 'call', id: 'mfz3k2a0q9x7c1', method: 'getUser', args: [42] },
      'call getUser #q9x7c1',
    ],
    [{ rik: 1, type: 'result', id: 'mfz3k2a0q9x7c1', ok: true, value: 1 }, 'result #q9x7c1 ok'],
    [
      {
        rik: 1,
        type: 'result',
        id: 'mfz3k2a0q9x7c1',
        ok: false,
        error: { name: 'IframeKitError', message: 'nope', code: 'RIK_TIMEOUT' },
      },
      'result #q9x7c1 error RIK_TIMEOUT: nope',
    ],
    [
      {
        rik: 1,
        type: 'result',
        id: 'mfz3k2a0q9x7c1',
        ok: false,
        error: { name: 'TypeError', message: 'x is not a function' },
      },
      'result #q9x7c1 error TypeError: x is not a function',
    ],
    [{ rik: 1, type: 'event', name: 'pinged' }, 'event pinged'],
  ])('summarizes %j as "%s"', (message, summary) => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logProtocolMessage(true, '←', message);
    expect(debug).toHaveBeenCalledWith(`react-iframe-kit ← ${summary}`, message);
  });

  it('appends the detail in parentheses', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const message = { rik: 1, type: 'result', id: 'abc123', ok: true } as const;
    logProtocolMessage(true, '←', message, 'getUser, 12 ms');
    expect(debug).toHaveBeenCalledWith(
      'react-iframe-kit ← result #abc123 ok (getUser, 12 ms)',
      message,
    );
  });
});
