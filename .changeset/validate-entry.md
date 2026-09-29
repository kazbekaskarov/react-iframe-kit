---
'react-iframe-kit': minor
---

New `react-iframe-kit/validate` entry (0.7 kB) for runtime checks of what crosses the boundary, with any Standard Schema library (Zod, Valibot, ArkType, …). `validateArgs(schema, method)` validates a method's arguments as a tuple and rejects invalid ones with the new `RIK_VALIDATION` code, which the caller receives as a `RemoteError` with the issues in `cause.data`. `validatePayload(schema, handler)` drops an invalid event and reports it with `reportError`. Both pass the schema's output on, so transforms and defaults apply. The RPC guide has a new "Validating what arrives" section.
