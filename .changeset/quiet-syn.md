---
'react-iframe-kit': patch
---

The host no longer causes a "target origin does not match" console error on every page with a cross-origin iframe. Its handshake prompt was aimed at the page's expected origin while the iframe still held its initial `about:blank`; it now goes to any origin, which is safe because it carries nothing and the page's reply is still checked for source and origin.
