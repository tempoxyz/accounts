---
'accounts': patch
---

Changed `email.sendCode` and `email.signIn`, on an instance with `clientSecret` or `clientAssertion`, to throw `Accounts.RequestError` with `server_error` and status 0 when the request receives no response, such as offline. Before, they threw the platform's `TypeError`.
