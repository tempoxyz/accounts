---
'accounts': patch
---

Fixed the error of a charge within the access key's signed limit that its spent limit does not cover, such as on a backend. The payment rejects with `mpp.LimitError`, which names the limit that is left, once the chain refuses the charge. Before, it rejected with Viem's `TransactionExecutionError`. Only the refusal reads the limit, so a charge that the chain takes sends no more requests. `mpp.LimitError` carries the chain's error as its `cause`, and a page still opens the sign-in for a new access key.

```ts
const response = await accounts
  .mpp({ session })
  .fetch('https://api.example.com/report')
  .catch((error) => {
    if (error instanceof LimitError) return renew(error.message)
    throw error
  })
```
