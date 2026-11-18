---
'accounts': patch
---

Changed `email.sendCode` and `email.signIn`, on an instance without `clientSecret` or `clientAssertion`, to throw `Accounts.RequestError` with `server_error` and status 0 when a request before the code verifies receives no response, such as offline. Before, they threw the platform's `TypeError`.
