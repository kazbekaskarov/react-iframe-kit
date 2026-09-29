import { act, cleanup, render } from '@testing-library/react';
import { StrictMode, useEffect, useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import type { Side } from '../core/contract';
import { useIframeEvent } from './useIframeEvent';
import { useIframeRPC } from './useIframeRPC';
import { useIframeTitle } from './useIframeTitle';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

type ChildSide = Side<{
  methods: { echo(value: string): string };
  events: { submitted: { id: string } };
}>;

// Found by the React 18 e2e run: every hook resolves its target in a layout effect
// after each commit, and scheduling a same-value update there looped with several of
// them in one component ("Maximum update depth exceeded"). They must settle.
it('settles with several hooks on one iframe in a StrictMode component', async () => {
  const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
  let renders = 0;
  function Host() {
    renders++;
    const [iframe, setIframe] = useState<HTMLIFrameElement | null>(null);
    const [early, setEarly] = useState('pending');
    const { remote, status } = useIframeRPC<ChildSide>(iframe, {
      methods: { ping: () => 'pong' },
    });
    useIframeEvent<ChildSide, 'submitted'>(iframe, 'submitted', () => {});
    const title = useIframeTitle(iframe);
    useEffect(() => {
      remote.echo('x').then(setEarly, () => setEarly('rejected'));
    }, [remote]);
    return (
      <>
        <output>{`${status} ${early}`}</output>
        <iframe ref={setIframe} title={title ?? 'frame'} src="https://widget.example.com/" />
      </>
    );
  }
  render(
    <StrictMode>
      <Host />
    </StrictMode>,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
  expect(errors).not.toHaveBeenCalled();
  expect(renders).toBeLessThan(30);
});
