---
'react-iframe-kit': patch
---

Fix `copyStyles` under a nonce-based Content Security Policy in Firefox: copied `<style>` and `<link>` elements now carry the original's `nonce`, so a host policy like `style-src 'nonce-…'` (which the `<Frame>` document inherits) no longer blocks them.
