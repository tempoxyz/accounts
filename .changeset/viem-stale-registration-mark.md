---
'accounts': patch
---

Fixed the `viem` plugin's transaction of an access key whose registration mark the chain no longer matches, such as after a reset of a local chain. The node refused the fill without the key authorization with `KeyNotFound`, Viem sent 5 more requests, and the transaction threw `AccessKeyError`. The fill now runs once more with the stored key authorization, and the transaction sends: `eth_fillTransaction` twice, then `eth_sendRawTransactionSync`.

```ts
await accounts.token.transferSync({ amount, to, token }) // registers the access key
// The local node restarts on a new chain.
await accounts.token.transferSync({ amount, to, token }) // registers the access key again
```
