---
'accounts': patch
---

Changed the `relay` plugin to relay over the `viem` plugin's transport without its `relay` route. Before, an instance with `viem({ relay })` and `relay({ account })` sent the route's own fill back to the route, which looped, and the transaction then paid its own fees.
