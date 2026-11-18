---
'accounts': patch
---

Added `mpp.LimitError`. A charge of `accounts.fetch` or `accounts.mpp` outside the access key's signed limits, in a token that they do not name or above the whole limit of its token, throws `mpp.LimitError` before the access key signs. Only a charge outside the signed limits reads the chain's limits, in one round, so a limit that `updateLimit` raised still pays. A charge within the signed limits that the spent limit refuses, or one that can swap from another token through `autoSwap` or a machine-token route, still rejects with the chain's error. Before, the payer filled and signed a charge that the chain refuses, and rejected with the chain's error.

```ts
const accounts = Accounts.create({
  accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
  plugins: [mpp()],
})

await accounts.fetch(url) // mpp.LimitError for a charge in another token, or above 10 OUSD
```
