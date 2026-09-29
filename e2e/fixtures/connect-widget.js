// A host for a react-iframe-kit widget, written without react-iframe-kit: wire protocol
// v1 by hand, for a page on any framework or none. It is the example on the docs page
// "Integrate without the library", and e2e/manual-host.spec.ts runs it against the real
// widget in every engine (and e2e/skew.spec.ts against the last published one), so it
// can't drift from what the library does. Copy it as is, or port it.

/**
 * Connects to the widget in `iframe` and returns a handle to talk to it.
 *
 * @param {HTMLIFrameElement} iframe
 * @param {{
 *   origin: string,
 *   methods?: Record<string, (...args: any[]) => unknown>,
 *   onEvent?: (name: string, payload: unknown) => void,
 *   onStatus?: (status: 'connecting' | 'connected') => void,
 *   timeout?: number,
 * }} options `origin` is the widget's origin, exactly (`https://widget.example.com`).
 *   `methods` are what the widget may call; `timeout` applies to each call, in ms.
 */
export function connectWidget(iframe, options) {
  const { origin, methods = {}, onEvent = () => {}, onStatus = () => {} } = options;
  const timeout = options.timeout ?? 10_000;

  let instance; // the widget page load this session is with, from its `syn`
  let port; // the session's private MessagePort
  let connected = false; // the widget said `ready`
  let inert = false;
  let nextId = 0;
  const pending = new Map(); // call id → { resolve, reject, timer }
  const queue = []; // messages sent while not connected, flushed on `ready`

  const send = (message) => {
    if (connected) port.postMessage({ rik: 1, ...message });
    else queue.push(message);
  };

  // Asks the widget to announce itself, in case it started before this code ran. The
  // prompt carries nothing, so it may go to any origin: the reply is what gets checked.
  const prompt = () =>
    iframe.contentWindow?.postMessage({ rik: 1, type: 'syn', versions: [1] }, '*');

  function endSession(reason) {
    port?.close();
    port = undefined;
    instance = undefined;
    connected = false;
    queue.length = 0;
    for (const call of pending.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
    pending.clear();
    onStatus('connecting');
  }

  function onWindowMessage(event) {
    const message = event.data;
    // Only the widget's own announcement: from this iframe and the widget's origin, a
    // `syn` with an `instance` (a random id per page load). Anything else is not ours.
    if (event.source !== iframe.contentWindow || event.origin !== origin) return;
    if (message?.rik !== 1 || message.type !== 'syn') return;
    if (typeof message.instance !== 'string' || !message.versions?.includes?.(1)) return;
    if (message.instance === instance) return; // a repeat: one syn per prompt, answered once
    if (instance !== undefined) endSession('the widget reloaded'); // a new page load

    const channel = new MessageChannel();
    const session = channel.port1;
    instance = message.instance;
    port = session;
    session.onmessage = (portEvent) => {
      if (session === port) onPortMessage(portEvent.data);
    };
    // The ack goes to the origin just checked, so no other page can take the port.
    const ack = { rik: 1, type: 'ack', session: randomId(), instance, version: 1 };
    iframe.contentWindow.postMessage(ack, origin, [channel.port2]);
  }

  function onPortMessage(message) {
    if (message?.rik !== 1) return;
    switch (message.type) {
      case 'ready': // the handshake is done: the widget listens on the port
        connected = true;
        onStatus('connected');
        if (inert) send({ type: 'inert', inert: true });
        for (const queued of queue.splice(0)) send(queued);
        break;
      case 'size': // the widget's content size in CSS px (with its `autoResize`)
        iframe.style.height = `${message.height}px`;
        break;
      case 'title': // the widget's `document.title` (with its `syncTitle`)
        iframe.title = message.title;
        break;
      case 'event':
        onEvent(message.name, message.payload);
        break;
      case 'call':
        answer(port, message);
        break;
      case 'result': {
        const call = pending.get(message.id);
        if (!call) return; // timed out already
        pending.delete(message.id);
        clearTimeout(call.timer);
        if (message.ok) call.resolve(message.value);
        else call.reject(Object.assign(new Error(message.error.message), message.error));
        break;
      }
      case 'bye': // the widget page is going away: a navigation, or the back/forward cache
        endSession('the widget left');
        prompt(); // a page restored from the back/forward cache waits to be asked
        break;
    }
  }

  async function answer(session, { id, method, args }) {
    let result;
    try {
      if (!Object.hasOwn(methods, method)) {
        const error = new Error(`no method named "${method}"`);
        throw Object.assign(error, { name: 'IframeKitError', code: 'RIK_METHOD_NOT_FOUND' });
      }
      result = { ok: true, value: await methods[method](...args) };
    } catch (thrown) {
      // `name` and `message` must be strings; `code` (a string or number) is optional.
      const error = thrown instanceof Error ? thrown : new Error(String(thrown));
      result = { ok: false, error: { name: error.name, message: error.message, code: error.code } };
    }
    try {
      session.postMessage({ rik: 1, type: 'result', id, ...result });
    } catch (error) {
      // The value can't be structured-cloned (a function, say): answer with that.
      session.postMessage({
        rik: 1,
        type: 'result',
        id,
        ok: false,
        error: { name: error.name, message: error.message },
      });
    }
  }

  window.addEventListener('message', onWindowMessage);
  const onLoad = () => connected || prompt();
  iframe.addEventListener('load', onLoad);
  onStatus('connecting');
  prompt();

  return {
    /** Calls a method of the widget. Resolves with its return value. */
    call(method, ...args) {
      return new Promise((resolve, reject) => {
        const id = String(nextId++);
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`"${method}" timed out`));
        }, timeout);
        pending.set(id, { resolve, reject, timer });
        send({ type: 'call', id, method, args });
      });
    },
    /** Sends the widget an event. */
    emit(name, payload) {
      send({ type: 'event', name, payload });
    },
    /** Makes the widget inert (a modal on the host page is open), inside and out. */
    setInert(value) {
      inert = value;
      iframe.inert = value;
      if (connected) send({ type: 'inert', inert: value });
    },
    dispose() {
      if (connected) port.postMessage({ rik: 1, type: 'bye' });
      endSession('disposed');
      window.removeEventListener('message', onWindowMessage);
      iframe.removeEventListener('load', onLoad);
    },
  };
}

const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
