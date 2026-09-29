import type { NextConfig } from 'next';

// This example lives inside the library's repository, which has a lockfile of its own:
// keep Next.js from treating the repository as the workspace root.
const config: NextConfig = {
  outputFileTracingRoot: import.meta.dirname,
  turbopack: { root: import.meta.dirname },
};

export default config;
