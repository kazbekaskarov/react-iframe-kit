---
'react-iframe-kit': minor
---

`<Frame>` and `useIframe` work on pages that enforce Trusted Types. The hook now sets the iframe's `srcdoc` itself, through a `react-iframe-kit` policy that can only create the library's empty default document; before, such a page threw during commit and took down the whole React tree. A custom `srcDoc` can be a `TrustedHTML`. A document the page still blocks is reported as `RIK_INVALID_OPTIONS` in `error` instead of throwing.

Breaking for `useIframe` users: `frameProps` is now `{ ref }` without `srcDoc`, and the server-rendered `<iframe>` no longer has a `srcdoc` attribute (it is set on the client).
