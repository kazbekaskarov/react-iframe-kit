/**
 * When a parent connection counts as timed out: still `connecting` after `ms`. Shared
 * by `useIframeRPC` and `connectToIframe`. See docs/design.md → Behaviour (Status).
 */
import type { ParentConnection } from './parentConnection';

/**
 * Calls `onTimeout` once `connection` has been `connecting` for `getMs()` ms. The wait
 * starts when the status enters `connecting` and restarts on every iframe `load` while
 * connecting (a reloaded page gets its full time). For `loading="lazy"` it starts only
 * at `load`: off screen, the iframe hasn't started loading. `Infinity` never times out.
 * Returns the function that stops watching.
 */
export function watchConnectDeadline(
  iframe: HTMLIFrameElement,
  connection: Pick<ParentConnection, 'status' | 'onStatusChange'>,
  getMs: () => number,
  onTimeout: () => void,
): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = () => {
    clearTimeout(timer);
    const ms = getMs();
    if (ms < Infinity) timer = setTimeout(onTimeout, ms); // setTimeout(Infinity) fires at once
  };
  const onLoad = () => {
    if (connection.status === 'connecting') arm();
  };
  iframe.addEventListener('load', onLoad);
  const off = connection.onStatusChange((status) => {
    clearTimeout(timer);
    if (status === 'connecting' && iframe.loading !== 'lazy') arm();
  });
  return () => {
    off();
    iframe.removeEventListener('load', onLoad);
    clearTimeout(timer);
  };
}
