---
'react-iframe-kit': minor
---

New `react-iframe-kit/child/lite` entry, for embedded pages that only need to be sized, titled or made inert: its `connectToParent` has no RPC and events, and weighs 4.1 kB gzipped instead of 6.3 kB. It also ships as `dist/child-lite.global.js` for `<script>` use. It shares the page's connection with the full `connectToParent`, so both can be used on one page, and a call from the parent to a lite page fails fast with `RIK_METHOD_NOT_FOUND`. The full `react-iframe-kit/child` is unchanged for its users.
