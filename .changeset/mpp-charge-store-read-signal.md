---
'accounts': patch
---

Fixed `accounts.fetch` of the `mpp` plugin, which ignored the request's signal while the store read before a charge's signature stalled, such as on a Redis client that queues commands while it reconnects. An abort of the signal now rejects the charge with the signal's reason, and the access key signs nothing.

```ts
const response = await accounts.fetch(url, { signal: AbortSignal.timeout(10_000) })
```
