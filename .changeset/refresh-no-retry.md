---
'accounts': patch
---

Changed `backend.get` and `backend.fetch` with `namespace` to throw a refused refresh token's `invalid_grant` at once. Before, each sent the refused token again after one second, which cost a second request. `Actions.refresh` still sends a refused token once more, since a concurrent refresh with the same token fails until the other one returns.
