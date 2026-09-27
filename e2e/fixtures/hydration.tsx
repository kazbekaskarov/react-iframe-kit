// Server-rendered <Frame> whose iframe finishes loading before hydration starts.
// docs/design.md → SSR and Portal mode (fix step 3).
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
await new Promise((resolve) => iframe.addEventListener('load', resolve, { once: true }));
root.dataset['loadedBeforeHydration'] = String(iframe.contentDocument?.readyState === 'complete');

hydrateRoot(root, app, {
  onRecoverableError: (error) => {
    root.dataset['hydrationError'] = String(error);
  },
});
