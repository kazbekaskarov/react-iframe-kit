import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockChild } from '../testing/mockChild';
import { connectToIframe, type IframeHandle } from './connectToIframe';
import type { Side } from './contract';
import { RemoteError } from './errors';
import { type StandardSchemaV1, validateArgs } from './validate';

type ParentSide = Side<{
  methods: { getUser(id: number): { name: string } };
  events: { theme: string };
}>;
type ChildSide = Side<{
  methods: { add(a: number, b: number): number };
  events: { submitted: { id: string } };
}>;

const SRC = 'https://widget.example.com/embed';
const cleanups: Array<() => void> = [];

function frame(attributes: Record<string, string> = {}): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  iframe.src = SRC;
  for (const [name, value] of Object.entries(attributes)) iframe.setAttribute(name, value);
  document.body.append(iframe);
  cleanups.push(() => iframe.remove());
  return iframe;
}

function connect<R extends ChildSide = ChildSide>(
  iframe: HTMLIFrameElement,
  options: Parameters<typeof connectToIframe<R, ParentSide>>[1] = {},
): IframeHandle<R, ParentSide> {
  const handle = connectToIframe<R, ParentSide>(iframe, options);
  cleanups.push(() => handle.dispose());
  return handle;
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  vi.useRealTimers();
});

describe('connectToIframe', () => {
  it('connects, and carries calls and events both ways', async () => {
    const iframe = frame();
    const statuses: string[] = [];
    const host = connect(iframe, {
      methods: { getUser: (id) => ({ name: `user ${id}` }) },
      onStatusChange: (status) => statuses.push(status),
    });
    expect(host.status).toBe('connecting');
    const child = mockChild<ParentSide, ChildSide>(iframe, { methods: { add: (a, b) => a + b } });
    cleanups.push(() => child.dispose());

    await host.whenConnected();
    expect(host.status).toBe('connected');
    expect(statuses).toEqual(['connected']);
    await expect(host.whenConnected()).resolves.toBeUndefined();
    await expect(host.remote.add(2, 3)).resolves.toBe(5);
    await expect(child.remote.getUser(7)).resolves.toEqual({ name: 'user 7' });

    const submitted: string[] = [];
    host.on('submitted', ({ id }) => submitted.push(id));
    child.emit('submitted', { id: '42' });
    await vi.waitFor(() => expect(submitted).toEqual(['42']));
  });

  it('resizes the height by default, within limits, and reports every size', async () => {
    const iframe = frame();
    const onResize = vi.fn();
    const onResizeLoop = vi.fn();
    const host = connect(iframe, { resize: true, onResize, onResizeLoop });
    const child = mockChild(iframe);
    cleanups.push(() => child.dispose());
    expect(host.size).toBeNull();

    child.resize({ width: 300, height: 120 });
    await vi.waitFor(() => expect(iframe.style.height).toBe('120px'));
    expect(iframe.style.width).toBe('');
    expect(host.size).toEqual({ width: 300, height: 120 });
    expect(onResize).toHaveBeenLastCalledWith({ width: 300, height: 120 });

    child.resize({ width: 300, height: 130, loop: true });
    await vi.waitFor(() => expect(onResizeLoop).toHaveBeenCalledOnce());
    child.resize({ width: 300, height: 130, loop: true });
    child.resize({ width: 300, height: 140 });
    await vi.waitFor(() => expect(host.size).toEqual({ width: 300, height: 140 }));
    expect(onResizeLoop).toHaveBeenCalledOnce();
  });

  it('resizes the axes and limits it is given, and nothing without `resize`', async () => {
    const both = frame();
    connect(both, { resize: { axis: 'both', maxHeight: 100, minWidth: 400 } });
    const bothChild = mockChild(both);
    cleanups.push(() => bothChild.dispose());
    bothChild.resize({ width: 300, height: 120 });
    await vi.waitFor(() => expect(both.style.height).toBe('100px'));
    expect(both.style.width).toBe('400px');

    const width = frame();
    connect(width, { resize: { axis: 'width' } });
    const widthChild = mockChild(width);
    cleanups.push(() => widthChild.dispose());
    widthChild.resize({ width: 300, height: 120 });
    await vi.waitFor(() => expect(width.style.width).toBe('300px'));
    expect(width.style.height).toBe('');

    const none = frame();
    const host = connect(none);
    const noneChild = mockChild(none);
    cleanups.push(() => noneChild.dispose());
    noneChild.resize({ width: 300, height: 120 });
    await vi.waitFor(() => expect(host.size).toEqual({ width: 300, height: 120 }));
    expect(none.style.height).toBe('');
  });

  it('syncs the title into the attribute, and restores the original', async () => {
    const titled = frame({ title: 'Tickets' });
    const host = connect(titled, { syncTitle: true });
    const child = mockChild(titled);
    child.setTitle('Checkout');
    await vi.waitFor(() => expect(titled.title).toBe('Checkout'));
    expect(host.title).toBe('Checkout');
    child.setTitle('');
    await vi.waitFor(() => expect(titled.title).toBe('Tickets'));
    expect(host.title).toBeNull();
    child.setTitle('Payment');
    await vi.waitFor(() => expect(titled.title).toBe('Payment'));
    host.dispose();
    expect(titled.title).toBe('Tickets');
    child.dispose();

    const untitled = frame();
    const other = connect(untitled, { syncTitle: true });
    const otherChild = mockChild(untitled);
    otherChild.setTitle('Checkout');
    await vi.waitFor(() => expect(untitled.title).toBe('Checkout'));
    other.dispose();
    expect(untitled.hasAttribute('title')).toBe(false);
    otherChild.dispose();
  });

  it('reads the title without touching the attribute unless asked', async () => {
    const iframe = frame({ title: 'Tickets' });
    const host = connect(iframe);
    const child = mockChild(iframe);
    cleanups.push(() => child.dispose());
    child.setTitle('Checkout');
    await vi.waitFor(() => expect(host.title).toBe('Checkout'));
    expect(iframe.title).toBe('Tickets');
  });

  it('makes the iframe inert inside and out, and leaves an attribute it did not set', async () => {
    const iframe = frame();
    const host = connect(iframe);
    const child = mockChild(iframe);
    cleanups.push(() => child.dispose());
    await child.whenConnected();

    host.setInert(true);
    expect(iframe.hasAttribute('inert')).toBe(true);
    await vi.waitFor(() => expect(child.inert).toBe(true));
    host.setInert(false);
    expect(iframe.hasAttribute('inert')).toBe(false);
    await vi.waitFor(() => expect(child.inert).toBe(false));

    iframe.setAttribute('inert', '');
    host.setInert(true);
    host.setInert(false);
    expect(iframe.hasAttribute('inert')).toBe(true);

    iframe.removeAttribute('inert');
    host.setInert(true);
    host.dispose(); // undoes it
    expect(iframe.hasAttribute('inert')).toBe(false);
    host.setInert(true); // a no-op once disposed
    expect(iframe.hasAttribute('inert')).toBe(false);
  });

  it("reports 'timeout' after connectTimeout, then 'connected'", async () => {
    const iframe = frame();
    const statuses: string[] = [];
    const host = connect(iframe, {
      connectTimeout: 20,
      onStatusChange: (status) => statuses.push(status),
    });
    await vi.waitFor(() => expect(host.status).toBe('timeout'));
    const connected = host.whenConnected();
    const child = mockChild(iframe);
    cleanups.push(() => child.dispose());
    await connected;
    expect(statuses).toEqual(['timeout', 'connected']);
  });

  it('dispose rejects waiters and later whenConnected, and is idempotent', async () => {
    const iframe = frame();
    const host = connect(iframe);
    const waiting = host.whenConnected();
    host.dispose();
    host.dispose();
    await expect(waiting).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
    await expect(host.whenConnected()).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
  });

  it('throws for invalid options and releases what it took', () => {
    const iframe = frame();
    expect(() => connectToIframe(iframe, { origin: '*' })).toThrow(
      expect.objectContaining({ code: 'RIK_INVALID_OPTIONS' }),
    );
    const methods = {
      // biome-ignore lint/suspicious/noThenProperty: exercising the reserved-name rejection itself
      then: () => {},
    } as unknown as undefined;
    expect(() => connectToIframe(iframe, { methods })).toThrow(
      expect.objectContaining({ code: 'RIK_INVALID_OPTIONS' }),
    );
    // Nothing held on to the connection: a different origin is not a conflict now.
    const host = connect(iframe, { origin: 'https://other.example' });
    expect(host.status).toBe('connecting');
  });

  it('answers a call with invalid arguments with RIK_VALIDATION (validateArgs)', async () => {
    const userId: StandardSchemaV1<unknown, [number]> = {
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (value) =>
          Number.isInteger((value as unknown[])[0])
            ? { value: value as [number] }
            : { issues: [{ message: 'expected an integer', path: [0] }] },
      },
    };
    const iframe = frame();
    connect(iframe, {
      methods: { getUser: validateArgs(userId, (id) => ({ name: `user ${id}` })) },
    });
    const child = mockChild<ParentSide, ChildSide>(iframe);
    cleanups.push(() => child.dispose());
    await expect(child.remote.getUser(7)).resolves.toEqual({ name: 'user 7' });
    const error = await child.remote.getUser(1.5).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect((error as RemoteError).cause).toMatchObject({
      code: 'RIK_VALIDATION',
      data: [{ message: 'expected an integer', path: ['0'] }],
    });
  });
});
