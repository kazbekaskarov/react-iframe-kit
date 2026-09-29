// A host page without React: `connectToIframe` from `react-iframe-kit/host`, or, with
// `?iife`, the `<script>` build's `ReactIframeKitHost` global, the way a widget's
// loader script on a customer's site would use it. See e2e/host.spec.ts.
import type * as Host from 'react-iframe-kit/host';
import { CHILD_ORIGIN } from '../origins';
import type { ChildSide, HostSide } from './host-vanilla-contract';

async function loadHost(): Promise<typeof Host> {
  if (!new URLSearchParams(location.search).has('iife')) return import('react-iframe-kit/host');
  // A classic script, as on a page without a bundler, so the IIFE defines its global.
  const { default: code } = await import('kit-host-iife?raw');
  const script = document.createElement('script');
  script.textContent = code;
  document.head.append(script);
  return (window as unknown as { ReactIframeKitHost: typeof Host }).ReactIframeKitHost;
}

const { connectToIframe } = await loadHost();
const output = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement;

const iframe = document.querySelector('iframe') as HTMLIFrameElement;
iframe.src = `${CHILD_ORIGIN}/host-vanilla-child.html`;

const widget = connectToIframe<ChildSide, HostSide>(iframe, {
  methods: { getUser: (id) => ({ name: `user ${id}` }) },
  resize: true,
  syncTitle: true,
  onStatusChange: (status) => {
    output('status').textContent = status;
  },
});
widget.on('submitted', ({ id }) => {
  output('submitted').textContent = id;
});

document.getElementById('add')?.addEventListener('click', async () => {
  output('result').textContent = String(await widget.remote.add(2, 3));
});
let inert = false;
document.getElementById('inert')?.addEventListener('click', () => {
  inert = !inert;
  widget.setInert(inert);
});
