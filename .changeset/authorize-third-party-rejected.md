---
'accounts': patch
---

Fixed `authorize` for a third-party client ID, such as an origin. It now rejects with `Accounts.RequestError` and reason `rejected` before any authorization request. Before, its page sent a check of the browser's session that CORS always blocked, and threw the platform's `TypeError`. A `cli:` client ID's message names `device.signIn`. `session.get` with `reauthorize` returns `undefined` for a third-party client ID, with no authorization request, so the page shows its sign-in.

```ts
await accounts.authorize().catch((error) => error.reason) // 'rejected'
```
