---
'accounts': patch
---

Fixed `accounts.fetch` of the `mpp` plugin for an instance that shares its store with another instance, such as another process of a server. If the other instance signed out, the payer still signed each charge with the signed-out access key. The payer now reads the store before the access key signs a charge of the instance's session, and rejects with `Accounts.SignedOutError`.

```ts
await other.signOut()
await accounts.fetch(url) // rejects with Accounts.SignedOutError before the access key signs
```
