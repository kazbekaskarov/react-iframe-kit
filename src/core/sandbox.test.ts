import { afterEach, expect, it, vi } from 'vitest';
import { warnIneffectiveSandbox } from './sandbox';

afterEach(() => vi.restoreAllMocks());

function frame(sandbox: string | null, src?: string): HTMLIFrameElement {
  const iframe = document.createElement('iframe');
  if (sandbox !== null) iframe.setAttribute('sandbox', sandbox);
  if (src) iframe.src = src;
  return iframe;
}

it('warns once for allow-scripts + allow-same-origin on same-origin content', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const iframe = frame('allow-scripts allow-same-origin', '/widget');
  warnIneffectiveSandbox(iframe);
  warnIneffectiveSandbox(iframe);
  expect(warn).toHaveBeenCalledOnce();
  expect(warn.mock.calls[0]?.[0]).toMatch(/protects nothing/);
});

it('stays quiet for other origins, other flags and no sandbox', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  warnIneffectiveSandbox(frame('allow-scripts allow-same-origin', 'https://widget.example.com/'));
  warnIneffectiveSandbox(frame('allow-scripts'));
  warnIneffectiveSandbox(frame('allow-same-origin'));
  warnIneffectiveSandbox(frame(null));
  expect(warn).not.toHaveBeenCalled();
});
