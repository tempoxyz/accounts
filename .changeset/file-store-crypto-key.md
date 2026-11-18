---
'accounts': patch
---

Fixed `Store.file` for a value that holds a `CryptoKey`. It no longer writes a non-extractable access key or DPoP key as `{}`, whose restored session signs nothing. `setItem` rejects with a `TypeError` before it takes the lock or writes the file, as `Store.postgres` and `Store.redis` do.

```ts
await Store.file().setItem('session', { accessKey: { keyPair } }) // rejects with a TypeError
```
