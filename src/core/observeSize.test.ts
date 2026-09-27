import { describe, expect, it, vi } from 'vitest';
import { observeSize } from './observeSize';

// A document whose layout and scheduling the test drives by hand.
function setup({ withBody = true, withFonts = true } = {}) {
  const layout = { width: 300, height: 100 };
  const observers: { resize: (() => void)[]; mutation: (() => void)[] } = {
    resize: [],
    mutation: [],
  };
  const observed: unknown[] = [];
  const frames = new Map<number, () => void>();
  const timers = new Map<number, () => void>();
  let nextId = 1;

  const view = {
    innerWidth: 300,
    innerHeight: 150,
    ResizeObserver: class {
      constructor(callback: () => void) {
        observers.resize.push(callback);
      }
      observe(target: unknown) {
        observed.push(target);
      }
      disconnect = vi.fn();
    },
    MutationObserver: class {
      constructor(callback: () => void) {
        observers.mutation.push(callback);
      }
      observe = vi.fn();
      disconnect = vi.fn();
    },
    requestAnimationFrame: (callback: () => void) => {
      frames.set(nextId, callback);
      return nextId++;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void) => {
      timers.set(nextId, callback);
      return nextId++;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };

  const documentElement = {
    getBoundingClientRect: () => layout,
    get clientWidth() {
      return 300;
    },
    clientHeight: 150,
    get scrollWidth() {
      return 300;
    },
    get scrollHeight() {
      return 150;
    },
  };
  const listeners = new Map<string, EventListener>();
  const fontListeners = new Map<string, EventListener>();
  const doc = {
    defaultView: view,
    documentElement,
    body: withBody ? { tagName: 'BODY' } : null,
    addEventListener: (type: string, listener: EventListener) => listeners.set(type, listener),
    removeEventListener: (type: string) => listeners.delete(type),
    fonts: withFonts
      ? {
          addEventListener: (type: string, listener: EventListener) =>
            fontListeners.set(type, listener),
          removeEventListener: (type: string) => fontListeners.delete(type),
        }
      : undefined,
  } as unknown as Document;

  const runFrame = () => {
    const [id, callback] = [...frames][0] ?? [];
    if (id !== undefined) frames.delete(id);
    callback?.();
  };
  const runTimer = () => {
    const [id, callback] = [...timers][0] ?? [];
    if (id !== undefined) timers.delete(id);
    callback?.();
  };

  return {
    doc,
    layout,
    observers,
    observed,
    frames,
    timers,
    listeners,
    fontListeners,
    runFrame,
    runTimer,
  };
}

describe('observeSize', () => {
  it('reports the initial size synchronously', () => {
    const { doc } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize);
    expect(onSize).toHaveBeenCalledTimes(1);
    expect(onSize.mock.calls[0]?.[0]).toMatchObject({ width: 300, height: 100 });
  });

  it('observes <html> and <body> for resizes', () => {
    const { doc, observed } = setup();
    observeSize(doc, vi.fn());
    expect(observed).toEqual([doc.documentElement, doc.body]);
  });

  it('batches triggers into one measurement per frame and skips unchanged sizes', () => {
    const { doc, layout, observers, frames, timers, runFrame } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize);

    layout.height = 200;
    observers.resize[0]?.();
    observers.mutation[0]?.();
    expect(frames.size).toBe(1);
    expect(timers.size).toBe(1);

    runFrame();
    expect(onSize).toHaveBeenCalledTimes(2);
    expect(onSize.mock.calls[1]?.[0]).toMatchObject({ height: 200 });
    expect(timers.size).toBe(0); // the fallback timer was cancelled

    observers.resize[0]?.();
    runFrame();
    expect(onSize).toHaveBeenCalledTimes(2); // unchanged
  });

  it('falls back to the timer when animation frames are paused', () => {
    const { doc, layout, observers, frames, runTimer } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize);

    layout.width = 500;
    observers.mutation[0]?.();
    runTimer();

    expect(onSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 500 }));
    expect(frames.size).toBe(0);
  });

  it('does not report an unrendered (0 × 0) document', () => {
    const { doc, layout, observers, runFrame } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize);

    layout.width = 0;
    layout.height = 0;
    observers.resize[0]?.();
    runFrame();

    expect(onSize).toHaveBeenCalledTimes(1);
  });

  it('re-measures on load, transition, animation and font events', () => {
    const { doc, layout, listeners, fontListeners, runFrame } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize);

    for (const trigger of [
      listeners.get('load'),
      listeners.get('transitionend'),
      listeners.get('animationend'),
      fontListeners.get('loadingdone'),
    ]) {
      layout.height += 10;
      trigger?.(new Event('x'));
      runFrame();
    }
    expect(onSize).toHaveBeenCalledTimes(5);
  });

  it('passes a custom measure function through', () => {
    const { doc } = setup();
    const onSize = vi.fn();
    observeSize(doc, onSize, () => ({ width: 1, height: 2 }));
    expect(onSize).toHaveBeenCalledWith(expect.objectContaining({ width: 1, height: 2 }));
  });

  it('stops observing and cancels pending work', () => {
    const { doc, observers, frames, timers, listeners, fontListeners } = setup();
    const stop = observeSize(doc, vi.fn());
    observers.resize[0]?.();

    stop();

    expect(frames.size).toBe(0);
    expect(timers.size).toBe(0);
    expect(listeners.size).toBe(0);
    expect(fontListeners.size).toBe(0);
  });

  it('works without <body> and without document.fonts', () => {
    const { doc, observed } = setup({ withBody: false, withFonts: false });
    const stop = observeSize(doc, vi.fn());
    expect(observed).toEqual([doc.documentElement]);
    expect(stop).not.toThrow();
  });

  it('does nothing for a document without a window', () => {
    const onSize = vi.fn();
    const stop = observeSize({ defaultView: null } as unknown as Document, onSize);
    expect(onSize).not.toHaveBeenCalled();
    expect(stop).not.toThrow();
  });
});
