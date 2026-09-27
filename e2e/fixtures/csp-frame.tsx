// `copyStyles` under a host CSP with `style-src 'nonce-…'`: the srcdoc document
// inherits the policy, so copied styles only apply if cloning kept their nonce.
// See e2e/csp.spec.ts.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Frame } from 'react-iframe-kit';

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <Frame title="frame" copyStyles>
      <p className="probe">frame probe</p>
      <p className="canary">frame canary</p>
    </Frame>
  </StrictMode>,
);
