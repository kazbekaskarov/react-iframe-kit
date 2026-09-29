---
'react-iframe-kit': minor
---

`allowedOrigins` accepts predicates, `(origin) => boolean`, next to origin strings and `RegExp`s. That's for multi-tenant embeds such as a white-label widget, whose allowed hosts come from configuration: the predicate is asked on every handshake, so the list can change while the page is open. Only an exact `true` allows, so an async predicate (which returns a `Promise`) allows nothing. The Security guide has a new "Multi-tenant embeds" section, including per-tenant `frame-ancestors`.
