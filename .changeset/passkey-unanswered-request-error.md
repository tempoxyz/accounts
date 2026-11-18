---
'accounts': patch
---

Changed `passkey.signIn`, `passkey.prepare`, and `passkey.register` to throw `Accounts.RequestError` with `server_error` and status 0 when a request receives no response, such as offline. Before, they threw the platform's `TypeError`.
