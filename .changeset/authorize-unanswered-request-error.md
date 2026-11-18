---
'accounts': patch
---

Fixed `authorize` and `session.get` with `reauthorize` for a request without a response, such as offline. Both now throw `Accounts.RequestError` with `server_error` and status 0, as `session.refresh` and `signOut` do. Before, they threw the platform's `TypeError`, which no API page lists.

```ts
await accounts.session.get({ reauthorize: true }).catch((error) => error.status) // 0
```
