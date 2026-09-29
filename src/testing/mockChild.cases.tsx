// Shared by mockChild.test.tsx (happy-dom) and mockChild.jsdom.test.tsx: the parent
// hooks, tested against mockChild the way a library user would.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Side } from '../core/contract';
import { useIframeEvent } from '../react/useIframeEvent';
import { useIframeInert } from '../react/useIframeInert';
import { useIframeResize } from '../react/useIframeResize';
import { useIframeRPC } from '../react/useIframeRPC';
import { useIframeTitle } from '../react/useIframeTitle';
import { mockChild } from './mockChild';

type ParentSide = Side<{
  methods: { getUser(id: number): { name: string } };
  events: { theme: string };
}>;
type ChildSide = Side<{
  methods: { add(a: number, b: number): number; wait(): string };
  events: { submitted: { id: string } };
}>;

const SRC = 'https://widget.example.com/embed';

function Host() {
  const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
  const [result, setResult] = useState('none');
  const [submitted, setSubmitted] = useState('none');
  const { remote, emit, status } = useIframeRPC<ChildSide, ParentSide>(iframe, {
    methods: { getUser: (id) => ({ name: `user ${id}` }) },
  });
  useIframeEvent<ChildSide, 'submitted'>(iframe, 'submitted', (payload) =>
    setSubmitted(payload.id),
  );
  const size = useIframeResize(iframe);
  const title = useIframeTitle(iframe);
  return (
    <>
      <output data-testid="status">{status}</output>
      <output data-testid="result">{result}</output>
      <output data-testid="submitted">{submitted}</output>
      <output data-testid="size">{size ? `${size.width}x${size.height}` : 'none'}</output>
      <button type="button" onClick={() => remote.add(2, 3).then((sum) => setResult(String(sum)))}>
        add
      </button>
      <button
        type="button"
        onClick={() =>
          remote.wait().then(setResult, (error: { code?: string }) => setResult(String(error.code)))
        }
      >
        wait
      </button>
      <button type="button" onClick={() => emit('theme', 'dark')}>
        dark
      </button>
      <iframe ref={setIframe} title={title ?? 'Widget'} src={SRC} />
    </>
  );
}

// Found by tag: its title changes once the mock child reports one.
function iframeElement(): HTMLIFrameElement {
  const iframe = document.querySelector('iframe');
  if (!iframe) throw new Error('test setup: no iframe rendered');
  return iframe;
}

export function mockChildCases(): void {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe('mockChild', () => {
    it('connects to the parent hooks and answers their calls', async () => {
      render(<Host />);
      const child = mockChild<ParentSide, ChildSide>(iframeElement(), {
        methods: { add: (a, b) => a + b, wait: () => new Promise(() => {}) },
      });
      await child.whenConnected();
      expect(child.status).toBe('connected');
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connected'));

      screen.getByRole('button', { name: 'add' }).click();
      await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('5'));
      child.dispose();
    });

    it('calls the parent, and exchanges events both ways', async () => {
      render(<Host />);
      const child = mockChild<ParentSide, ChildSide>(iframeElement());
      await expect(child.remote.getUser(7)).resolves.toEqual({ name: 'user 7' });

      const themes: string[] = [];
      child.on('theme', (theme) => themes.push(theme));
      screen.getByRole('button', { name: 'dark' }).click();
      await waitFor(() => expect(themes).toEqual(['dark']));

      act(() => child.emit('submitted', { id: '42' }));
      await waitFor(() => expect(screen.getByTestId('submitted').textContent).toBe('42'));
      child.dispose();
    });

    it('reports a size and a title, including ones set before connecting', async () => {
      render(<Host />);
      const child = mockChild<ParentSide, ChildSide>(iframeElement());
      child.resize({ width: 300, height: 120 }); // may still be connecting: sent on connect
      child.setTitle('Checkout');
      await waitFor(() => expect(screen.getByTestId('size').textContent).toBe('300x120'));
      expect(iframeElement().style.height).toBe('120px');
      await waitFor(() => expect(iframeElement().title).toBe('Checkout'));

      child.resize({ width: 300, height: 200 });
      child.setTitle('Payment');
      await waitFor(() => expect(iframeElement().style.height).toBe('200px'));
      await waitFor(() => expect(iframeElement().title).toBe('Payment'));
      child.dispose();
    });

    it('connects when created before the parent hooks mount', async () => {
      const iframe = document.createElement('iframe');
      iframe.src = SRC;
      document.body.append(iframe);
      const child = mockChild<ParentSide, ChildSide>(iframe, { methods: { add: (a, b) => a * b } });

      function LateHost() {
        const { remote, status } = useIframeRPC<ChildSide>(iframe);
        const [result, setResult] = useState('none');
        return (
          <>
            <output data-testid="status">{status}</output>
            <output data-testid="result">{result}</output>
            <button
              type="button"
              onClick={() => remote.add(2, 3).then((n) => setResult(String(n)))}
            >
              add
            </button>
          </>
        );
      }
      render(<LateHost />);
      await child.whenConnected();
      screen.getByRole('button', { name: 'add' }).click();
      await waitFor(() => expect(screen.getByTestId('result').textContent).toBe('6'));
      child.dispose();
      iframe.remove();
    });

    it('dispose unloads the page: pending parent calls reject, the parent reconnects', async () => {
      render(<Host />);
      const child = mockChild<ParentSide, ChildSide>(iframeElement(), {
        methods: { wait: () => new Promise(() => {}) },
      });
      await child.whenConnected();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connected'));

      screen.getByRole('button', { name: 'wait' }).click();
      await new Promise((resolve) => setTimeout(resolve, 20));
      act(() => child.dispose());
      expect(child.status).toBe('disposed');
      await waitFor(() =>
        expect(screen.getByTestId('result').textContent).toBe('RIK_CONNECTION_LOST'),
      );
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connecting'));
      await expect(child.whenConnected()).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
      child.dispose(); // idempotent

      // A fresh mock can take over the same iframe.
      const next = mockChild<ParentSide, ChildSide>(iframeElement(), { methods: { add: () => 1 } });
      await next.whenConnected();
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connected'));
      next.dispose();
    });

    it("reports 'timeout' after connectTimeout, and 'connected' once the child shows up", async () => {
      function SlowHost() {
        const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
        const { status } = useIframeRPC(iframe, { connectTimeout: 30 });
        return (
          <>
            <output data-testid="status">{status}</output>
            <iframe ref={setIframe} title="Widget" src={SRC} />
          </>
        );
      }
      render(<SlowHost />);
      expect(screen.getByTestId('status').textContent).toBe('connecting');
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('timeout'));

      const child = mockChild(iframeElement());
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connected'));
      // A lost connection gets its full time again.
      act(() => child.dispose());
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connecting'));
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('timeout'));
    });

    it("counts a lazy iframe's time from its load, and never times out with Infinity", async () => {
      // Detached, so nothing loads it but the test (a lazy iframe off screen).
      const iframe = document.createElement('iframe');
      iframe.loading = 'lazy';
      iframe.src = SRC;
      function LazyHost({ connectTimeout }: { connectTimeout: number }) {
        const { status } = useIframeRPC(iframe, { connectTimeout });
        return <output data-testid="status">{status}</output>;
      }
      render(<LazyHost connectTimeout={30} />);
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(screen.getByTestId('status').textContent).toBe('connecting');
      act(() => {
        iframe.dispatchEvent(new Event('load'));
      });
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('timeout'));
      cleanup();

      render(<LazyHost connectTimeout={Infinity} />);
      act(() => {
        iframe.dispatchEvent(new Event('load'));
      });
      await new Promise((resolve) => setTimeout(resolve, 80));
      expect(screen.getByTestId('status').textContent).toBe('connecting');
    });

    it('rejects whenConnected when disposed before connecting', async () => {
      const iframe = document.createElement('iframe');
      document.body.append(iframe);
      const child = mockChild(iframe); // no parent hook: never connects
      const waiting = child.whenConnected();
      child.dispose();
      await expect(waiting).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
      iframe.remove();
    });

    it('needs an iframe in the document', () => {
      expect(() => mockChild(document.createElement('iframe'))).toThrow(/in the document/);
    });

    it('turns debug on from any hook, not only useIframeRPC', async () => {
      const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
      function ResizeOnly() {
        const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
        const title = useIframeTitle(iframe);
        useIframeResize(iframe, { debug: true });
        return <iframe ref={setIframe} title={title ?? 'none'} src={SRC} />;
      }
      render(<ResizeOnly />);
      const child = mockChild(iframeElement());
      await child.whenConnected();
      await waitFor(() =>
        expect(debug).toHaveBeenCalledWith(
          expect.stringMatching(/^react-iframe-kit ← ready/),
          expect.anything(),
        ),
      );
      expect(iframeElement().title).toBe('none'); // useIframeTitle: null before a title
      child.dispose();
    });

    it('sees useIframeInert, which also owns the iframe’s inert attribute', async () => {
      function InertHost({ inert }: { inert: boolean }) {
        const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
        useIframeInert(iframe, inert);
        return <iframe ref={setIframe} title="Widget" src={SRC} />;
      }
      const { rerender } = render(<InertHost inert={false} />);
      const child = mockChild(iframeElement());
      await child.whenConnected();
      expect(child.inert).toBe(false);

      rerender(<InertHost inert />);
      expect(iframeElement().hasAttribute('inert')).toBe(true);
      await waitFor(() => expect(child.inert).toBe(true));

      rerender(<InertHost inert={false} />);
      expect(iframeElement().hasAttribute('inert')).toBe(false);
      await waitFor(() => expect(child.inert).toBe(false));

      rerender(<InertHost inert />);
      await waitFor(() => expect(child.inert).toBe(true));
      child.dispose();
      expect(child.inert).toBe(false);
    });

    it('useIframeInert makes a same-origin document inert directly, across reloads', async () => {
      function SameOriginHost({ inert }: { inert: boolean }) {
        const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
        useIframeInert(iframe, inert);
        return <iframe ref={setIframe} title="Same" srcDoc="<p>same</p>" />;
      }
      const { rerender } = render(<SameOriginHost inert />);
      const iframe = iframeElement();
      const body = () => iframe.contentDocument?.body;
      await waitFor(() => expect(body()?.hasAttribute('inert')).toBe(true));

      iframe.dispatchEvent(new Event('load')); // a reload: applied to the document again
      expect(body()?.hasAttribute('inert')).toBe(true);

      rerender(<SameOriginHost inert={false} />);
      expect(body()?.hasAttribute('inert')).toBe(false);
      expect(iframe.hasAttribute('inert')).toBe(false);
    });
  });
}
