import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CHILD_ORIGIN } from '../origins';

function Host() {
  return (
    <main>
      <h1>host</h1>
      <iframe title="cross-origin child" src={`${CHILD_ORIGIN}/child.html`} />
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Host />
  </StrictMode>,
);
