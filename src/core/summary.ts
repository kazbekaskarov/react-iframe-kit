import type { PortMessage, WindowMessage } from './protocol';

/** A short, stable form of a call id: its random tail (the head is a timestamp). */
const shortId = (id: string): string => `#${id.slice(-6)}`;

/**
 * A one-line description of a protocol message: its type plus what identifies it
 * (`call getUser #q9x7c1`, `size 320×480`). For `debug` logs (dev build only) and the
 * devtools entry.
 */
export function summarizeProtocolMessage(message: WindowMessage | PortMessage): string {
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
    case 'inert':
      return `inert ${message.inert ? 'on' : 'off'}`;
    case 'title':
      return `title ${JSON.stringify(message.title)}`;
    case 'size':
      return `size ${message.width}×${message.height}${message.loop ? ' loop' : ''}`;
    default:
      return message.type;
  }
}
