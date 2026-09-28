import type { PortMessage, WindowMessage } from './protocol';
import { getRegistry, type ProtocolListener } from './registry';
import { summarizeProtocolMessage } from './summary';

/**
 * Every protocol message sent or received on this page goes through here. Listeners
 * (`onProtocolMessage`, e.g. the Redux DevTools adapter) always see it; `debug: true`
 * also logs it to the console: a one-line summary, then the message itself. See
 * docs/design.md → Errors, Devtools. Shared by both connection sides so the format
 * matches. `detail` is what only the logging side knows, e.g. which call a result
 * answers and how long it took (dev and `debug` only).
 */
export function logProtocolMessage(
  enabled: boolean,
  direction: '→' | '←',
  message: WindowMessage | PortMessage,
  detail?: string,
): void {
  const listeners = getRegistry().protocolListeners;
  if (listeners) for (const listener of listeners) listener({ direction, message, detail });
  if (!enabled) return;
  /* v8 ignore start: __DEV__ is compile-time and `true` in tests. The summary is left
   * out of the production build to keep it within its size budget. */
  if (!__DEV__) {
    console.debug(`react-iframe-kit ${direction}`, message);
    return;
  }
  /* v8 ignore stop */
  const summary = summarizeProtocolMessage(message);
  console.debug(
    `react-iframe-kit ${direction} ${detail ? `${summary} (${detail})` : summary}`,
    message,
  );
}

/** Subscribes `listener` to every protocol message on this page, from every copy. */
export function onProtocolMessage(listener: ProtocolListener): () => void {
  const registry = getRegistry();
  registry.protocolListeners ??= new Set();
  const listeners = registry.protocolListeners;
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
