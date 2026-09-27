import { afterEach, describe, expect, it, vi } from 'vitest';
import { logProtocolMessage } from './debugLog';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logProtocolMessage', () => {
  it('logs when enabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logProtocolMessage(true, '→', { rik: 1, type: 'syn' });
    expect(debug).toHaveBeenCalledWith('react-iframe-kit →', { rik: 1, type: 'syn' });
  });

  it('does nothing when disabled', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    logProtocolMessage(false, '←', { rik: 1, type: 'ack' });
    expect(debug).not.toHaveBeenCalled();
  });
});
