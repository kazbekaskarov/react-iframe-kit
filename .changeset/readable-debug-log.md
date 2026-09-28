---
'react-iframe-kit': patch
---

`debug: true` logs are easier to read in development: each line starts with a summary such as `call getUser #q9x7c1` or `result #q9x7c1 ok (getUser, 12 ms)`, pairing every result with its call and showing how long it took. The message object is still logged after it. Production builds log as before.
