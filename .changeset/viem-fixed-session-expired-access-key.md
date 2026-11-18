---
'accounts': patch
---

Refused a transaction of an expired access key in a fixed session of `accounts.viem({ session })` outside a page, with `Accounts.SignedOutError` among the causes of its error, or `Accounts.KeyRequiredError` while an access key of the session on another chain lives. Before, the client filled, estimated, signed, and broadcast the transaction with the expired access key, and the node refused it.

```ts
await accounts.viem({ session }).token.transferSync({ amount, to, token })
```
