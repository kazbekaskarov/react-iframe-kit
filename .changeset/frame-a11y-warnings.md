---
'react-iframe-kit': patch
---

`<Frame>` warns in development about a missing or generic `title`, a `title` shared with another mounted `<Frame>`, and a negative `tabIndex`: the iframe accessibility problems axe-core reports as serious. The checks are removed from production builds.
