---
'accounts': patch
---

Added `store` to `backend.Sessions`, which holds the `viem` plugin's marks of registered access keys when the instance has no `store`. `Sessions.durableObject` returns one that keeps each mark in the Durable Object of its key, through the new `getItem`, `removeItem`, and `setItem` RPC methods of `DurableObject.sessions`. Before, each request of a Worker with `backend({ sessions })` attached the key authorization again, and the node refused it. A transfer of a registered access key sent 7 requests in place of 2.
