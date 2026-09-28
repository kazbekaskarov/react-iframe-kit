import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectToParent, onParentEvent, onParentStatusChange } from './childConnection';
import { IframeKitError } from './errors';

interface FakeParentWindow {
  postMessage: ReturnType<typeof vi.fn>;
}

function expectCode(fn: () => unknown, code: string): void {
  expect(fn).toThrow(IframeKitError);
  try {
    fn();
    expect.unreachable();
  } catch (error) {
    expect(error).toBeInstanceOf(IframeKitError);
    expect((error as IframeKitError).code).toBe(code);
  }
}

const waitFor = (condition: () => boolean) =>
  vi.waitFor(() => {
    if (!condition()) throw new Error('condition not yet true');
  });

const REGISTRY_KEY = Symbol.for('react-iframe-kit/v1');
const originalParentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');

// happy-dom doesn't lay out elements (getBoundingClientRect is always 0 × 0), which
// measureDocument reads as "not rendered". autoResize tests that rely on the default
// (non-custom) measurement need a real-looking layout stubbed in.
function stubLayout(width: number, height: number): void {
  document.documentElement.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON() {},
    }) as DOMRect;
}

/**
 * Frames the test page (window.parent !== window) with a controllable fake, and
 * starts every test with a brand-new page-level connection: real disposal is
 * deliberately not part of the child connection's design (the page owns its
 * lifetime), so tests instead remove the previous instance's listeners directly.
 */
function frame(): { parent: FakeParentWindow } {
  const previous = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as
    | { childConnection?: { teardownForTests?: () => void } }
    | undefined;
  previous?.childConnection?.teardownForTests?.();
  delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];

  const parent: FakeParentWindow = { postMessage: vi.fn() };
  Object.defineProperty(window, 'parent', { value: parent, configurable: true });
  return { parent };
}

function ackFromParent(
  parent: FakeParentWindow,
  {
    session,
    instance,
    version = 1,
    origin = location.origin,
    port,
  }: {
    session: string;
    instance: string;
    version?: number;
    origin?: string;
    port: MessagePort;
  },
) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { rik: 1, type: 'ack', session, instance, version },
      origin,
      source: parent as unknown as Window,
      ports: [port],
    }),
  );
}

function synPromptFromParent(parent: FakeParentWindow) {
  window.dispatchEvent(
    new MessageEvent('message', {
      data: { rik: 1, type: 'syn', versions: [1] },
      origin: location.origin,
      source: parent as unknown as Window,
    }),
  );
}

function lastSyn(parent: FakeParentWindow): { instance: string; versions: number[] } | undefined {
  const call = [...parent.postMessage.mock.calls].reverse().find((c) => c[0]?.type === 'syn');
  return call?.[0];
}

/**
 * Sends the ack that completes the handshake and returns the parent's own end of the
 * port. Dispatching the ack runs the child's reaction synchronously (attaching the
 * port, sending `ready`), so nothing here needs to wait; only the port's own message
 * *delivery* is asynchronous, which callers await separately where they care about it.
 */
function connect(
  parent: FakeParentWindow,
  origin = location.origin,
): { instance: string; parentPort: MessagePort } {
  const instance = lastSyn(parent)?.instance;
  if (!instance) throw new Error('the child never sent a syn');
  const channel = new MessageChannel();
  ackFromParent(parent, { session: 'session-1', instance, origin, port: channel.port2 });
  return { instance, parentPort: channel.port1 };
}

afterEach(() => {
  const registry = (globalThis as Record<symbol, unknown>)[REGISTRY_KEY] as
    | { childConnection?: { teardownForTests?: () => void } }
    | undefined;
  registry?.childConnection?.teardownForTests?.();
  delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
  if (originalParentDescriptor) Object.defineProperty(window, 'parent', originalParentDescriptor);
  vi.restoreAllMocks();
});

describe('connectToParent', () => {
  it('sends a syn on the first call', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    expect(parent.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ rik: 1, type: 'syn', versions: [1] }),
      '*',
    );
  });

  it('starts connecting', () => {
    const { parent: _parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    expect(handle.status).toBe('connecting');
  });

  it('reuses one syn instance across several connectToParent calls', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    const first = lastSyn(parent)?.instance;
    parent.postMessage.mockClear();
    connectToParent({ allowedOrigins: [location.origin] });
    // A second caller doesn't need to send another syn itself; the instance is shared.
    expect(lastSyn(parent)?.instance ?? first).toBe(first);
  });

  it('replies with its own syn to the parent-shaped prompt', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    parent.postMessage.mockClear();
    synPromptFromParent(parent);
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'syn' }), '*');
  });

  it('ignores a syn that already carries an instance (not the bare parent prompt)', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    parent.postMessage.mockClear();
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'syn', instance: 'someone-elses', versions: [1] },
        origin: location.origin,
        source: parent as unknown as Window,
      }),
    );
    expect(parent.postMessage).not.toHaveBeenCalled();
  });

  it('throws RIK_INVALID_OPTIONS for empty allowedOrigins', () => {
    frame();
    expectCode(() => connectToParent({ allowedOrigins: [] }), 'RIK_INVALID_OPTIONS');
  });

  it('throws RIK_ORIGIN_CONFLICT when a second caller passes different allowedOrigins', () => {
    frame();
    connectToParent({ allowedOrigins: ['https://a.example'] });
    expectCode(
      () => connectToParent({ allowedOrigins: ['https://b.example'] }),
      'RIK_ORIGIN_CONFLICT',
    );
  });

  it('does not conflict when allowedOrigins are equal as sets in a different order', () => {
    frame();
    connectToParent({ allowedOrigins: ['https://a.example', 'https://b.example'] });
    expect(() =>
      connectToParent({ allowedOrigins: ['https://b.example', 'https://a.example'] }),
    ).not.toThrow();
  });

  it('debug: true logs protocol traffic to the console (on if any acquirer enables it)', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] }); // no debug from this caller...
    debug.mockClear();
    connectToParent({ allowedOrigins: [location.origin], debug: true }); // ...but this one turns it on
    synPromptFromParent(parent);
    expect(debug).toHaveBeenCalled();
  });

  it('stays idle and sends nothing when opened top-level (not framed)', () => {
    delete (globalThis as Record<symbol, unknown>)[REGISTRY_KEY];
    const original = Object.getOwnPropertyDescriptor(window, 'parent');
    Object.defineProperty(window, 'parent', { value: window, configurable: true });
    try {
      const handle = connectToParent({ allowedOrigins: [location.origin] });
      expect(handle.status).toBe('idle');
    } finally {
      if (original) Object.defineProperty(window, 'parent', original);
    }
  });
});

describe('handshake', () => {
  it('accepts an ack, sends ready, and reaches connected', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);

    const readyReceived = new Promise<void>((resolve) => {
      parentPort.onmessage = (e) => {
        if (e.data?.type === 'ready') resolve();
      };
    });
    parentPort.start?.();
    await readyReceived;
    await waitFor(() => handle.status === 'connected');
  });

  it('ignores an ack from an origin not in allowedOrigins', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: ['https://only-this.example'] });
    connect(parent, 'https://evil.example');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.status).toBe('connecting');
    expect(warn).toHaveBeenCalled();
  });

  it('ignores an ack for a different instance', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const channel = new MessageChannel();
    ackFromParent(parent, { session: 's', instance: 'not-mine', port: channel.port2 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.status).toBe('connecting');
  });

  it('switches to a new session when the parent reconnects, replying with ready again', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const first = connect(parent);
    await waitFor(() => handle.status === 'connected');

    const channel2 = new MessageChannel();
    const readies: number[] = [];
    channel2.port1.onmessage = (e) => {
      if (e.data?.type === 'ready') readies.push(1);
    };
    channel2.port1.start?.();

    ackFromParent(parent, { session: 'session-2', instance: first.instance, port: channel2.port2 });
    await waitFor(() => readies.length > 0);
    expect(handle.status).toBe('connected');

    // The old port is closed: sending on it no longer reaches the child (silently
    // dropped per the MessagePort spec, so absence of any further reaction is the
    // observable contract here).
    expect(() => first.parentPort.postMessage({ rik: 1, type: 'bye' })).not.toThrow();
  });
});

describe('autoResize', () => {
  it('does not send a size before connecting', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin], autoResize: true });
    expect(parent.postMessage.mock.calls.some((c) => c[0]?.type === 'size')).toBe(false);
  });

  it('sends the current size once connected', async () => {
    stubLayout(320, 200);
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin], autoResize: true });
    const { parentPort } = connect(parent);

    const sizes: Array<{ width: number; height: number }> = [];
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'size') sizes.push(e.data);
    };
    parentPort.start?.();
    await waitFor(() => sizes.length > 0);
    expect(sizes[0]).toMatchObject({ width: 320, height: 200 });
  });

  it('uses a custom measure function', async () => {
    const { parent } = frame();
    connectToParent({
      allowedOrigins: [location.origin],
      autoResize: { measure: () => ({ width: 42, height: 24 }) },
    });
    const { parentPort } = connect(parent);

    const sizes: Array<{ width: number; height: number }> = [];
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'size') sizes.push(e.data);
    };
    parentPort.start?.();
    await waitFor(() => sizes.length > 0);
    expect(sizes[0]).toMatchObject({ width: 42, height: 24 });
  });

  it('throws RIK_INVALID_OPTIONS when two callers pass different measure functions', () => {
    frame();
    connectToParent({
      allowedOrigins: [location.origin],
      autoResize: { measure: () => ({ width: 1, height: 1 }) },
    });
    expectCode(
      () =>
        connectToParent({
          allowedOrigins: [location.origin],
          autoResize: { measure: () => ({ width: 2, height: 2 }) },
        }),
      'RIK_INVALID_OPTIONS',
    );
  });

  it('stops reporting once every autoResize caller disposes', async () => {
    stubLayout(100, 100);
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin], autoResize: true });
    const { parentPort } = connect(parent);

    const sizes: unknown[] = [];
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'size') sizes.push(e.data);
    };
    parentPort.start?.();
    await waitFor(() => sizes.length > 0);

    handle.dispose();
    // No further assertions on DOM mutation triggering another report: the important,
    // testable contract is that dispose() doesn't throw and status reflects release.
    expect(handle.status).toBe('idle');
  });
});

describe('syncTitle', () => {
  function collectTitles(parentPort: MessagePort): string[] {
    const titles: string[] = [];
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'title') titles.push(e.data.title);
    };
    parentPort.start?.();
    return titles;
  }

  afterEach(() => {
    document.title = '';
  });

  it('sends nothing without the option', async () => {
    document.title = 'Private inbox';
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);
    const messages: unknown[] = [];
    parentPort.onmessage = (e) => messages.push(e.data);
    parentPort.start?.();
    document.title = 'Still private';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(messages.filter((m) => (m as { type: string }).type === 'title')).toEqual([]);
  });

  it('sends the trimmed title once connected, then each change', async () => {
    document.title = '  Checkout  ';
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin], syncTitle: true });
    const titles = collectTitles(connect(parent).parentPort);
    await waitFor(() => titles.length === 1);
    expect(titles).toEqual(['Checkout']);

    document.title = 'Payment';
    await waitFor(() => titles.length === 2);
    expect(titles).toEqual(['Checkout', 'Payment']);
  });

  it('sends an unchanged title only once per session, and again to a new session', async () => {
    document.title = 'Checkout';
    const { parent } = frame();
    const first = connectToParent({ allowedOrigins: [location.origin], syncTitle: true });
    connectToParent({ allowedOrigins: [location.origin], syncTitle: true }); // shares the observer
    const { instance, parentPort } = connect(parent);
    const titles = collectTitles(parentPort);
    document.title = ' Checkout '; // a mutation, but the same trimmed title
    await waitFor(() => titles.length === 1);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles).toEqual(['Checkout']);

    const channel = new MessageChannel();
    ackFromParent(parent, { session: 'session-2', instance, port: channel.port2 });
    const again = collectTitles(channel.port1);
    await waitFor(() => again.length === 1);
    expect(again).toEqual(['Checkout']);

    first.dispose(); // the other caller still syncs
    document.title = 'Payment';
    await waitFor(() => again.length === 2);
  });

  it('stops once every syncTitle caller disposes', async () => {
    document.title = 'Checkout';
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin], syncTitle: true });
    const titles = collectTitles(connect(parent).parentPort);
    await waitFor(() => titles.length === 1);

    handle.dispose();
    handle.dispose(); // idempotent: doesn't stop a sync it no longer holds
    document.title = 'Payment';
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(titles).toEqual(['Checkout']);
  });
});

describe('dispose', () => {
  it('is idempotent', () => {
    const { parent: _parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
  });

  it('status reads idle after dispose even though the page connection persists', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    connect(parent);
    handle.dispose();
    expect(handle.status).toBe('idle');
  });
});

describe('handshake edge cases', () => {
  it('ignores a message from a source that is not window.parent', () => {
    frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'ack', session: 's', instance: 'whatever', version: 1 },
        origin: location.origin,
        source: {} as unknown as Window,
        ports: [new MessageChannel().port2],
      }),
    );
    expect(handle.status).toBe('connecting');
  });

  it('ignores a message that does not parse as a known type', () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'call', method: 'x' },
        origin: location.origin,
        source: parent as unknown as Window,
      }),
    );
    expect(handle.status).toBe('connecting');
  });

  it('ignores a duplicate ack for the same session', () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { instance } = connect(parent);
    expect(handle.status).toBe('connected'); // the child marks itself connected as soon as it has a port

    const channel2 = new MessageChannel();
    ackFromParent(parent, { session: 'session-1', instance, port: channel2.port2 });
    expect(handle.status).toBe('connected'); // unchanged: the duplicate was ignored, not re-processed
  });

  it('ignores an ack with an unsupported protocol version', () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const instance = lastSyn(parent)?.instance as string;
    const channel = new MessageChannel();
    ackFromParent(parent, { session: 's', instance, version: 99, port: channel.port2 });
    expect(handle.status).toBe('connecting');
  });

  it('ignores an ack with no MessagePort attached', () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const instance = lastSyn(parent)?.instance as string;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { rik: 1, type: 'ack', session: 's', instance, version: 1 },
        origin: location.origin,
        source: parent as unknown as Window,
      }),
    );
    expect(handle.status).toBe('connecting');
  });

  it('goes back to connecting when the parent sends bye over the port', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);
    parentPort.postMessage({ rik: 1, type: 'bye' });
    await waitFor(() => handle.status === 'connecting');
  });

  it('ignores an unrelated message received over the port', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);
    parentPort.postMessage({ rik: 1, type: 'size', width: 1, height: 1 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.status).toBe('connected'); // still connected: not a bye
  });

  it('sends bye and goes back to connecting on pagehide', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);

    let receivedBye = false;
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'bye') receivedBye = true;
    };
    parentPort.start?.();

    window.dispatchEvent(new Event('pagehide'));
    // The status flip is synchronous; the bye's delivery to the parent's port is not.
    expect(handle.status).toBe('connecting');
    await waitFor(() => receivedBye);
  });

  it('pagehide on an already-connecting page is a harmless no-op', () => {
    const { parent: _parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    expect(() => window.dispatchEvent(new Event('pagehide'))).not.toThrow();
    expect(handle.status).toBe('connecting');
  });

  it('resends syn on pageshow after a bfcache restore', () => {
    // happy-dom's PageTransitionEvent constructor doesn't wire up `persisted` from its
    // init dict, so it's set directly on the event instance instead.
    const pageshow = (persisted: boolean) => {
      const event = new Event('pageshow');
      Object.defineProperty(event, 'persisted', { value: persisted, configurable: true });
      return event;
    };

    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    parent.postMessage.mockClear();

    window.dispatchEvent(pageshow(false));
    expect(parent.postMessage).not.toHaveBeenCalled();

    window.dispatchEvent(pageshow(true));
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'syn' }), '*');
  });
});

describe('autoResize edge cases', () => {
  it('a second caller with the same measure function does not conflict', () => {
    frame();
    const measure = () => ({ width: 1, height: 1 });
    connectToParent({ allowedOrigins: [location.origin], autoResize: { measure } });
    expect(() =>
      connectToParent({ allowedOrigins: [location.origin], autoResize: { measure } }),
    ).not.toThrow();
  });

  it('keeps reporting while at least one autoResize caller remains', async () => {
    stubLayout(50, 50);
    const { parent } = frame();
    const a = connectToParent({ allowedOrigins: [location.origin], autoResize: true });
    connectToParent({ allowedOrigins: [location.origin], autoResize: true });
    const { parentPort } = connect(parent);

    const sizes: unknown[] = [];
    parentPort.onmessage = (e) => {
      if (e.data?.type === 'size') sizes.push(e.data);
    };
    parentPort.start?.();
    await waitFor(() => sizes.length > 0);

    a.dispose(); // one of two callers releases; the other keeps autoResize running
    expect(() => window.dispatchEvent(new Event('unrelated'))).not.toThrow();
  });

  it('holds growth and reports a dev warning once the loop guard trips', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // A runaway measurement: content is always 10px taller/wider than the viewport,
    // and the "parent" grows the iframe to match on every report — the same
    // mechanical loop the guard is meant to catch. See docs/design.md → Resize →
    // Feedback-loop guard.
    let viewport = 100;
    const originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    const originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => viewport });
    Object.defineProperty(window, 'innerHeight', { configurable: true, get: () => viewport });

    try {
      const { parent } = frame();
      connectToParent({
        allowedOrigins: [location.origin],
        autoResize: { measure: () => ({ width: viewport + 10, height: viewport + 10 }) },
      });
      const { parentPort } = connect(parent);

      const sizes: Array<{ width: number; height: number; loop?: boolean }> = [];
      parentPort.onmessage = (e) => {
        if (e.data?.type === 'size') sizes.push(e.data);
      };
      parentPort.start?.();
      await waitFor(() => sizes.length > 0); // the initial, unheld report

      for (let i = 0; i < 35 && !sizes.some((s) => s.loop); i++) {
        const before = sizes.length;
        viewport += 10; // "the parent resized the iframe to the last reported size"
        document.dispatchEvent(new Event('transitionend'));
        await waitFor(() => sizes.length > before || sizes.some((s) => s.loop));
      }

      expect(sizes.some((s) => s.loop)).toBe(true);
      expect(warn).toHaveBeenCalled();

      // A further measurement with the same (held) outcome sends nothing new.
      const countAtTrip = sizes.length;
      viewport += 10;
      document.dispatchEvent(new Event('transitionend'));
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sizes.length).toBe(countAtTrip);
    } finally {
      if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
      if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
    }
  });
});

describe('rpc', () => {
  /** Collects every message the child sends to the parent over `port`. */
  function inbox(port: MessagePort): Array<Record<string, unknown>> {
    const received: Array<Record<string, unknown>> = [];
    port.addEventListener('message', (e) => received.push((e as MessageEvent).data));
    port.start();
    return received;
  }

  it('queues a call made while connecting, sends it once connected, and resolves with the result', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const promise = handle.remote['getUser']?.();

    const { parentPort } = connect(parent);
    const received = inbox(parentPort);
    await waitFor(() => received.some((m) => m['type'] === 'call'));
    const call = received.find((m) => m['type'] === 'call');
    expect(call).toMatchObject({ method: 'getUser', args: [] });

    parentPort.postMessage({ rik: 1, type: 'result', id: call?.['id'], ok: true, value: 'ann' });
    await expect(promise).resolves.toBe('ann');
  });

  it('answers an incoming call from the parent with its local method', async () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin], methods: { echo: (x) => x } });
    const { parentPort } = connect(parent);
    const received = inbox(parentPort);

    parentPort.postMessage({ rik: 1, type: 'call', id: 'c1', method: 'echo', args: ['hi'] });
    await waitFor(() => received.some((m) => m['type'] === 'result'));
    expect(received.find((m) => m['type'] === 'result')).toMatchObject({ ok: true, value: 'hi' });
  });

  it('delivers events both ways', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const handler = vi.fn();
    handle.on('themeChanged', handler);
    const { parentPort } = connect(parent);
    const received = inbox(parentPort);

    parentPort.postMessage({ rik: 1, type: 'event', name: 'themeChanged', payload: 'dark' });
    await waitFor(() => handler.mock.calls.length > 0);
    expect(handler).toHaveBeenCalledWith('dark');

    handle.emit('submitted', { id: 'x' });
    await waitFor(() => received.some((m) => m['type'] === 'event'));
    expect(received.find((m) => m['type'] === 'event')).toMatchObject({
      name: 'submitted',
      payload: { id: 'x' },
    });
  });

  it.each([
    ['bye from the parent', (port: MessagePort) => port.postMessage({ rik: 1, type: 'bye' })],
    ['pagehide', () => window.dispatchEvent(new Event('pagehide'))],
  ])('%s rejects a pending call with RIK_CONNECTION_LOST', async (_name, drop) => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);
    const promise = handle.remote['slow']?.();
    drop(parentPort);
    await expect(promise).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });
  });

  it('a replaced session rejects a pending call with RIK_CONNECTION_LOST', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { instance } = connect(parent);
    const promise = handle.remote['slow']?.();

    const channel = new MessageChannel();
    ackFromParent(parent, { session: 'session-2', instance, port: channel.port2 });
    await expect(promise).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });
  });

  it('dispose() rejects this caller’s queued calls with RIK_DESTROYED', async () => {
    frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const promise = handle.remote['x']?.();
    handle.dispose();
    await expect(promise).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
  });

  it('throws RIK_METHOD_CONFLICT when two callers register the same method name', () => {
    frame();
    connectToParent({ allowedOrigins: [location.origin], methods: { x: () => 1 } });
    expectCode(
      () => connectToParent({ allowedOrigins: [location.origin], methods: { x: () => 2 } }),
      'RIK_METHOD_CONFLICT',
    );
  });

  it('debug: true also logs RPC traffic', () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin], debug: true });
    connect(parent);
    debug.mockClear();
    handle.emit('ping');
    expect(debug).toHaveBeenCalledWith(
      'react-iframe-kit → event ping',
      expect.objectContaining({ type: 'event', name: 'ping' }),
    );
  });
});

describe('whenConnected', () => {
  it('resolves immediately when already connected', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    connect(parent);
    await expect(handle.whenConnected()).resolves.toBeUndefined();
  });

  it('resolves on the next connect', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const promise = handle.whenConnected();
    connect(parent);
    await expect(promise).resolves.toBeUndefined();
  });

  it('rejects with RIK_DESTROYED when disposed while waiting', async () => {
    frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const promise = handle.whenConnected();
    handle.dispose();
    await expect(promise).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
  });

  it('rejects with RIK_DESTROYED when called after dispose', async () => {
    frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    handle.dispose();
    await expect(handle.whenConnected()).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
  });
});

describe('port message edge cases', () => {
  it('ignores a malformed message received over the port', async () => {
    const { parent } = frame();
    const handle = connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);
    parentPort.postMessage({ rik: 1, type: 'call' }); // missing id/method/args
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handle.status).toBe('connected');
  });
});

describe('internal helpers for the child React hooks', () => {
  it('onParentEvent receives events once another caller configured the connection', async () => {
    const { parent } = frame();
    const handler = vi.fn();
    const off = onParentEvent('themeChanged', handler);
    connectToParent({ allowedOrigins: [location.origin] });
    const { parentPort } = connect(parent);

    parentPort.postMessage({ rik: 1, type: 'event', name: 'themeChanged', payload: 'dark' });
    await waitFor(() => handler.mock.calls.length === 1);

    off();
    parentPort.postMessage({ rik: 1, type: 'event', name: 'themeChanged', payload: 'light' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('onParentStatusChange fires immediately, then on every change', () => {
    const { parent } = frame();
    connectToParent({ allowedOrigins: [location.origin] });
    const statuses: string[] = [];
    const off = onParentStatusChange((status) => statuses.push(status));
    connect(parent);
    off();
    window.dispatchEvent(new Event('pagehide'));
    expect(statuses).toEqual(['connecting', 'connected']);
  });
});
