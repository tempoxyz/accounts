---
'accounts': patch
---

Fixed `backend.fetch` sending a `DPoP` header of `init` beside a Bearer token. The request now replaces both `Authorization` and `DPoP`, as `Actions.fetch` does.
