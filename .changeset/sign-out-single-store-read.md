---
'accounts': patch
---

Removed a read of the store from `signOut` in an instance that has not read the session yet, such as a CLI's `logout`. The first read of the session holds the store's latest copy, so the sign-out reads the session once before the revocation, not twice. One round trip to the store less, such as to `Store.redis` or `Store.file`.

```ts
await accounts.signOut()
```
