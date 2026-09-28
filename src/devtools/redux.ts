/**
 * Shows the page's protocol traffic in the Redux DevTools browser extension: one
 * action per message, named by its summary (`→ call getUser #q9x7c1`), with the
 * message as payload. See docs/design.md → Devtools.
 */
import { onProtocolMessage } from '../core/debugLog';
import type { PortMessage, WindowMessage } from '../core/protocol';
import { summarizeProtocolMessage } from '../core/summary';

export interface ReduxDevToolsOptions {
  /** The instance name in the extension. Default `react-iframe-kit`. */
  name?: string | undefined;
  /** How many actions the extension keeps. Default: the extension's own (50). */
  maxAge?: number | undefined;
}

interface DevToolsConnection {
  init(state: unknown): void;
  send(action: { type: string; [key: string]: unknown }, state: unknown): void;
}

interface DevToolsExtension {
  connect(options: { name?: string; maxAge?: number }): DevToolsConnection;
}

/**
 * Starts sending every protocol message on this page to the Redux DevTools extension,
 * whichever connection or library copy it belongs to. Returns the function that stops.
 * Without the extension (or on the server) it does nothing.
 */
export function connectReduxDevTools(options: ReduxDevToolsOptions = {}): () => void {
  const extension =
    typeof window === 'undefined'
      ? undefined
      : (window as { __REDUX_DEVTOOLS_EXTENSION__?: DevToolsExtension })
          .__REDUX_DEVTOOLS_EXTENSION__;
  if (!extension) return () => {};

  const connection = extension.connect({
    name: options.name ?? 'react-iframe-kit',
    ...(options.maxAge === undefined ? {} : { maxAge: options.maxAge }),
  });
  let sent = 0;
  let received = 0;
  connection.init({ sent, received });

  return onProtocolMessage(({ direction, message, detail }) => {
    if (direction === '→') sent++;
    else received++;
    const summary = summarizeProtocolMessage(message as WindowMessage | PortMessage);
    connection.send(
      { type: `${direction} ${detail ? `${summary} (${detail})` : summary}`, message },
      { sent, received, last: message },
    );
  });
}
