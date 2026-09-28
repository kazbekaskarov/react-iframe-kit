/**
 * Replaces `target.postMessage` with an own property that hands every message (and its
 * transfer list) to `handler`. Returns a function that restores the original.
 */
export function interceptPostMessage(
  target: Window,
  handler: (data: unknown, transfer: Transferable[] | undefined) => void,
): () => void {
  const own = Object.getOwnPropertyDescriptor(target, 'postMessage');
  Object.defineProperty(target, 'postMessage', {
    value: (data: unknown, _targetOrigin?: unknown, transfer?: Transferable[]) =>
      handler(data, transfer),
    configurable: true,
    writable: true,
  });
  return () => {
    if (own) Object.defineProperty(target, 'postMessage', own);
    else delete (target as { postMessage?: unknown }).postMessage;
  };
}

/**
 * Dispatches a `message` event on this page's window, as if `source` had posted it.
 * In a later task, like a real `postMessage`: code that posts during its own setup
 * (the page connection's first syn, sent from its constructor) must be able to finish
 * that setup before the answer arrives.
 */
export function receiveMessage(
  data: unknown,
  origin: string,
  source: Window,
  ports: MessagePort[] = [],
): void {
  setTimeout(() =>
    window.dispatchEvent(new MessageEvent('message', { data, origin, source, ports })),
  );
}
