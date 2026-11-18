---
'accounts': patch
---

`accounts.authorize` in a function `reauthorize` of `session.get`, such as the default of the `react` plugin at a mount, reads the store no more before its request when the authorization around it already read the store for the expired session. The renewal of an expired session at a mount sends its first request after one store round trip less, as with `reauthorize: true`.
