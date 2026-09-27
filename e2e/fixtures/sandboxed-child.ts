// Runs inside a `sandbox="allow-scripts"` iframe (no `allow-same-origin`), so its
// origin is opaque ("null"). See e2e/sandboxed-child.spec.ts and docs/design.md →
// Security → Opaque origins.
import { connectToParent } from 'react-iframe-kit/child';
import { HOST_ORIGIN } from '../origins';

connectToParent({ allowedOrigins: [HOST_ORIGIN], autoResize: true });
