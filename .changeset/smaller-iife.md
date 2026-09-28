---
'react-iframe-kit': patch
---

The `<script>` build of the child (`dist/child.global.js`) is 0.2 kB smaller gzipped: it no longer ships pure annotations, which only matter to a bundler. Production builds also stop reading `performance.now()` on every RPC call, which only the development build's `debug` timings use.
