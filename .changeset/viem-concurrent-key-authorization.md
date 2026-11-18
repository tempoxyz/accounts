---
'accounts': patch
---

Fixed concurrent transactions of an access key that the chain does not hold yet, such as two sends at once after a sign-in, or the sends that one retry's new access key resolves. Each transaction attached the key authorization, and the node kept only one of them, so the other failed or never landed. Now the fill of the second waits until the first transaction's receipt or failure, for up to 5 seconds, and fills again without the key authorization once the first lands. A receipt that `waitForTransactionReceipt` reads after an asynchronous send also marks the access key as registered.

```ts
await Promise.all([
  accounts.token.transferSync({ amount: 100_000n, to, token }),
  accounts.token.transferSync({ amount: 200_000n, to, token }),
])
```
