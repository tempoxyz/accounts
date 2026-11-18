---
'accounts': patch
---

Fixed `Store.postgres` and `Store.redis` for a value that holds a `CryptoKey`. They no longer store a browser's non-extractable access key as `{}`, whose restored session signs nothing. `setItem` rejects with a `TypeError` before any query or command, so a browser's sign-in on such a store rejects at once.

```ts
const accounts = Accounts.create({ plugins: [passkey()] }) // a browser keeps the session in IndexedDB
```

