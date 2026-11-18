---
'accounts': patch
---

Kept the registration mark of an access key when the node refuses a fill for a spent limit, such as a `token.transferSync` above the access key's limit. The refusal shows that the chain holds the access key, so the next transaction sends no key authorization, and sends one fill and the transaction. Before, the mark went, and the next transaction sent 5 more RPC requests.

```ts
await accounts.viem.token.transferSync({ amount: 11_000_000n, to, token }) // AccessKeySpendingLimitExceededError
await accounts.viem.token.transferSync({ amount: 1_000_000n, to, token }) // eth_fillTransaction, eth_sendRawTransactionSync
```
