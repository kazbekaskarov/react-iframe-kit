---
'react-iframe-kit': minor
---

New `react-iframe-kit/host` entry: `connectToIframe(iframe, options)`, the parent side without React, for host pages that aren't React apps, such as a white-label widget's loader script on customers' sites or a page moving off iframe-resizer. It resizes the iframe to the page's reports (`resize`, with `axis` and limits), carries typed calls and events, sets the iframe's `title` from the page (`syncTitle`), makes it inert (`setInert`), and reports `'connecting' | 'connected' | 'timeout'`. It shares the iframe's connection with any React hooks on it. Also ships as `dist/host.global.js` (global `ReactIframeKitHost`) for `<script>` use. The new "Embedding a widget" guide covers the whole white-label case: loader script, multi-tenant origins, theming, tokens, analytics, payments and cookies.
