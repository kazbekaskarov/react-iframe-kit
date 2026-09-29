import { useState } from 'react';
import { type IframeLoadStatus, observeIframeLoad } from '../core/iframeLoad';
import { type IframeTarget, useIframeTarget } from './useIframeTarget';
import { useIsomorphicLayoutEffect } from './useIsomorphicLayoutEffect';

export type { IframeLoadStatus };

export interface UseIframeLoadOptions {
  /**
   * `status` becomes `'timeout'` when the iframe hasn't loaded after this long (for
   * `loading="lazy"`, counted from when it scrolls into view). Default 30 s; `Infinity`
   * never times out.
   */
  timeout?: number | undefined;
}

/**
 * Whether any iframe has loaded, including one whose page doesn't run this library
 * (a map, a video, a partner's page): `'idle'` without an element, then `'loading'`,
 * `'loaded'` or `'timeout'`. A later `load` moves `'timeout'` on to `'loaded'`. See
 * docs/design.md → Third-party iframes.
 *
 * `'loaded'` only means the browser finished loading *a* document: an error page, or a
 * page that refuses to be framed, may load too. For a page that runs `connectToParent`,
 * `useIframeRPC`'s `status` says whether it actually answers.
 */
export function useIframeLoad(
  target: IframeTarget,
  options: UseIframeLoadOptions = {},
): IframeLoadStatus | 'idle' {
  const iframe = useIframeTarget(target);
  const [status, setStatus] = useState<IframeLoadStatus | 'idle'>('idle');
  const timeout = options.timeout ?? 30_000;

  useIsomorphicLayoutEffect(() => {
    if (!iframe) {
      setStatus('idle');
      return;
    }
    return observeIframeLoad(iframe, timeout, setStatus);
  }, [iframe, timeout]);

  return iframe ? status : 'idle';
}
