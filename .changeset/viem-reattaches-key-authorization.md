---
'accounts': patch
---

Fixed the `viem` plugin's second transaction of a session, which attached the key authorization again after the first transaction registered the access key. The node refused its fill with `KeyAlreadyExists`, and Viem sent five more requests. The next transaction now sends two requests: `eth_fillTransaction` and `eth_sendRawTransactionSync`.

```ts
await accounts.token.transferSync({ amount, to, token }) // registers the access key
await accounts.token.transferSync({ amount, to, token }) // attaches no key authorization
```
