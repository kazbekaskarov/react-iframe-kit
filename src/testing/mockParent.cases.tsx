// Shared by mockParent.test.tsx (happy-dom) and mockParent.jsdom.test.tsx: the child
// side, tested against mockParent the way a library user would.
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useParent, useParentEvent } from '../child/react';
import {
  type ConnectToParentOptions,
  connectToParent,
  type ParentHandle,
} from '../core/connectToParent';
import type { Side } from '../core/contract';
import { mockParent } from './mockParent';

type ParentSide = Side<{
  methods: { getUser(id: number): { name: string }; wait(): string };
  events: { theme: string };
}>;
type ChildSide = Side<{
  methods: { add(a: number, b: number): number };
  events: { submitted: { id: string } };
}>;

const allowedOrigins = [location.origin];

export function mockParentCases(): void {
  const handles: ParentHandle<ParentSide, ChildSide>[] = [];
  const connect = (options: Omit<ConnectToParentOptions<ChildSide>, 'allowedOrigins'> = {}) => {
    const handle = connectToParent<ParentSide, ChildSide>({ allowedOrigins, ...options });
    handles.push(handle);
    return handle;
  };

  afterEach(() => {
    cleanup();
    for (const handle of handles.splice(0)) handle.dispose();
    vi.restoreAllMocks();
  });

  describe('mockParent', () => {
    it('frames the page, connects, and carries calls both ways', async () => {
      const parent = mockParent<ChildSide, ParentSide>({
        methods: { getUser: (id) => ({ name: `user ${id}` }) },
      });
      expect(window.parent).not.toBe(window);
      const page = connect({ methods: { add: (a, b) => a + b } });

      await parent.whenConnected();
      expect(parent.status).toBe('connected');
      await page.whenConnected();
      await expect(page.remote.getUser(7)).resolves.toEqual({ name: 'user 7' });
      await expect(parent.remote.add(2, 3)).resolves.toBe(5);

      parent.dispose();
      expect(window.parent).toBe(window);
    });

    it('exchanges events, and records the reported size and title', async () => {
      // What autoResize needs in a DOM without layout; see the Testing guide. jsdom has
      // no ResizeObserver, and a 0 × 0 `<html>` counts as not rendered, so nothing
      // would be reported.
      const view = window as { ResizeObserver?: unknown };
      view.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(
        new DOMRect(0, 0, 1024, 768),
      );
      const parent = mockParent<ChildSide, ParentSide>();
      document.title = 'Checkout';
      const page = connect({
        autoResize: { measure: () => ({ width: 300, height: 120 }) },
        syncTitle: true,
      });
      await parent.whenConnected();

      const submitted: string[] = [];
      parent.on('submitted', (payload) => submitted.push(payload.id));
      page.emit('submitted', { id: '42' });
      await waitFor(() => expect(submitted).toEqual(['42']));

      const themes: string[] = [];
      page.on('theme', (theme) => themes.push(theme));
      parent.emit('theme', 'dark');
      await waitFor(() => expect(themes).toEqual(['dark']));

      await waitFor(() => expect(parent.size).toEqual({ width: 300, height: 120 }));
      await waitFor(() => expect(parent.title).toBe('Checkout'));
      parent.dispose();
      document.title = '';
    });

    it('dispose rejects the page’s pending calls, and a new mock reconnects it', async () => {
      const parent = mockParent<ChildSide, ParentSide>({
        methods: { wait: () => new Promise(() => {}) },
      });
      const page = connect();
      await parent.whenConnected();
      await page.whenConnected();

      const pending = page.remote.wait();
      await new Promise((resolve) => setTimeout(resolve, 20));
      parent.dispose();
      expect(parent.status).toBe('disposed');
      await expect(pending).rejects.toMatchObject({ code: 'RIK_CONNECTION_LOST' });
      await waitFor(() => expect(page.status).toBe('connecting'));
      await expect(parent.whenConnected()).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
      parent.dispose(); // idempotent

      const next = mockParent<ChildSide, ParentSide>({
        methods: { getUser: () => ({ name: 'ann' }) },
      });
      await next.whenConnected();
      await expect(page.remote.getUser(1)).resolves.toEqual({ name: 'ann' });
      next.dispose();
    });

    it('drives useParent and useParentEvent', async () => {
      const parent = mockParent<ChildSide, ParentSide>({
        methods: { getUser: () => ({ name: 'ann' }) },
      });

      function Page() {
        const [user, setUser] = useState('none');
        const [theme, setTheme] = useState('light');
        const { remote, status } = useParent<ParentSide, ChildSide>({
          allowedOrigins,
          methods: { add: (a, b) => a * b },
        });
        useParentEvent<ParentSide, 'theme'>('theme', setTheme);
        return (
          <>
            <output data-testid="status">{status}</output>
            <output data-testid="user">{user}</output>
            <output data-testid="theme">{theme}</output>
            <button type="button" onClick={() => remote.getUser(1).then((u) => setUser(u.name))}>
              load
            </button>
          </>
        );
      }
      render(<Page />);
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('connected'));
      screen.getByRole('button', { name: 'load' }).click();
      await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('ann'));
      await expect(parent.remote.add(2, 3)).resolves.toBe(6);
      act(() => parent.emit('theme', 'dark'));
      await waitFor(() => expect(screen.getByTestId('theme').textContent).toBe('dark'));
      cleanup();
      parent.dispose();
    });

    it("useParent reports 'timeout' after connectTimeout without a parent it accepts", async () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {}); // the dropped ack
      const parent = mockParent({ origin: 'https://not-allowed.example' });
      function Page() {
        const { status } = useParent({ allowedOrigins, connectTimeout: 30 });
        return <output data-testid="status">{status}</output>;
      }
      render(<Page />);
      await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('timeout'));
      cleanup();
      parent.dispose();
    });

    it('rejects whenConnected when disposed before the page connects', async () => {
      const parent = mockParent({ origin: 'https://not-allowed.example' });
      const waiting = parent.whenConnected();
      parent.dispose();
      await expect(waiting).rejects.toMatchObject({ code: 'RIK_DESTROYED' });
    });
  });
}
