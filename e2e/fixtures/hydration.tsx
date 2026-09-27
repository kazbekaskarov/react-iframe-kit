// Server-rendered <Frame> whose iframe finishes loading before hydration starts. The
// server renders no srcdoc, so that is the initial about:blank; hydration then sets the
// srcdoc and mounts into the final document. docs/design.md → SSR.
import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { Frame } from 'react-iframe-kit';

const app = (
  <StrictMode>
    <Frame title="frame">
      <p data-testid="content">hydrated</p>
    </Frame>
  </StrictMode>
);

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
root.innerHTML = renderToString(app);

const iframe = root.querySelector('iframe');
if (!iframe) throw new Error('server HTML has no iframe');
// Not the `load` event: for about:blank some engines fire it during insertion already.
while (iframe.contentDocument?.readyState !== 'complete') {
  await new Promise((resolve) => setTimeout(resolve, 10));
}
root.dataset['loadedBeforeHydration'] = String(!iframe.hasAttribute('srcdoc'));

hydrateRoot(root, app, {
  onRecoverableError: (error) => {
    root.dataset['hydrationError'] = String(error);
  },
});
