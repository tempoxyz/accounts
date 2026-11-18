---
'accounts': patch
---

Fixed `Store.redis`'s `setItem` for a value without a JSON form, such as a `CryptoKey` or a top-level `undefined`, and an `expiresAt` that passed. It rejects with a `TypeError` before any command, as a write without an expiry does. Before, it sent `DEL` and resolved, so the stored entry was deleted.

```ts
await store.setItem(key, { privateKey }, { expiresAt: Date.now() - 1 }) // TypeError, nothing deleted
```
