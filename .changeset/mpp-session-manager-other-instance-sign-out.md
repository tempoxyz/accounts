---
'accounts': patch
---

Fixed the session manager of `accounts.mpp.session()` in an instance that shares its store with another instance, such as another process of a server. If the other instance signed out, the manager kept paying each request with the signed-out access key. Each request, stream, and top-up now reads the store first, and rejects with `Accounts.SignedOutError` before any request.

```ts
const manager = accounts.mpp.session()
await other.signOut()
await manager.fetch(url) // rejects with Accounts.SignedOutError
```
