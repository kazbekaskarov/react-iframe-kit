import type { PortMessage, WindowMessage } from './protocol';

/**
 * `debug: true` logs all protocol traffic to the console: a one-line summary, then the
 * message itself. See docs/design.md → Errors. Shared by both connection sides so the
 * format matches. `detail` is what only the logging side knows, e.g. which call a
 * result answers and how long it took.
 */
export function logProtocolMessage(
  enabled: boolean,
  direction: '→' | '←',
  message: WindowMessage | PortMessage,
  detail?: string,
): void {
  if (!enabled) return;
  /* v8 ignore start: __DEV__ is compile-time and `true` in tests. The summary is left
   * out of the production build to keep it within its size budget. */
  if (!__DEV__) {
    console.debug(`react-iframe-kit ${direction}`, message);
    return;
  }
  /* v8 ignore stop */
  const summary = detail ? `${summarize(message)} (${detail})` : summarize(message);
  console.debug(`react-iframe-kit ${direction} ${summary}`, message);
}

/** A short, stable form of a call id: its random tail (the head is a timestamp). */
const shortId = (id: string): string => `#${id.slice(-6)}`;

function summarize(message: WindowMessage | PortMessage): string {
  switch (message.type) {
    case 'call':
      return `call ${message.method} ${shortId(message.id)}`;
    case 'result':
      return `result ${shortId(message.id)} ${
        message.ok
          ? 'ok'
          : `error ${message.error.code ?? message.error.name}: ${message.error.message}`
      }`;
    case 'event':
      return `event ${message.name}`;
    case 'title':
      return `title ${JSON.stringify(message.title)}`;
    case 'size':
      return `size ${message.width}×${message.height}${message.loop ? ' loop' : ''}`;
    default:
      return message.type;
  }
}
