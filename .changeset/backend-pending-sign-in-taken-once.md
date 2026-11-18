---
'accounts': patch
---

`backend.complete` spends a redirect in progress with the store's `takeItem`, after the `state` check. Of concurrent callbacks of one sign-in in processes that share a store, such as `Store.postgres` or `Store.redis`, only one redeems the code. Each other one throws `Accounts.PendingNotFoundError`, and sends no token request.

If a start under the same session ID replaces the redirect in progress after the read, `complete` throws `Accounts.PendingNotFoundError`, so the old code redeems nothing. The new redirect stays spent, as a removal after the read spends it.
