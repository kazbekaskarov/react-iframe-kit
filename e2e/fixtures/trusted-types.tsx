// <Frame> on a page that enforces Trusted Types, one CSP per page load: ?case=<name>.
// The header for each case is set in e2e/vite.config.ts. See e2e/trusted-types.spec.ts.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Frame } from 'react-iframe-kit';

interface HostPolicy {
  createHTML(input: string): { toJSON(): string };
}
const { trustedTypes } = window as unknown as {
  trustedTypes: {
    createPolicy(name: string, rules: { createHTML(input: string): string }): HostPolicy;
  };
};

const CUSTOM =
  '<!DOCTYPE html><html><head></head><body><p id="custom">custom document</p></body></html>';

const name = new URLSearchParams(location.search).get('case') ?? '';

function frame() {
  switch (name) {
    // A TrustedHTML from the host's own policy.
    case 'custom-trusted': {
      const host = trustedTypes.createPolicy('host', { createHTML: (input) => input });
      return <Frame title="frame" srcDoc={host.createHTML(CUSTOM)} />;
    }
    // A plain string, which the page's policy blocks.
    case 'custom-string':
      return <Frame title="frame" srcDoc={CUSTOM} />;
    default:
      return (
        <Frame title="frame" copyStyles resize>
          <p className="probe" data-testid="content">
            rendered under Trusted Types
          </p>
        </Frame>
      );
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing');
createRoot(root).render(
  <StrictMode>
    <p data-testid="host">host app</p>
    {frame()}
  </StrictMode>,
);
