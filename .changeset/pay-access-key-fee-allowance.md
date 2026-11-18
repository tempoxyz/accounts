---
'accounts': patch
---

`accounts.pay` with the `viem` plugin sends a payment with the access key only if the limit of the token that pays the fee also holds 0.1 for it: the plugin's `feeToken`, else the payment's token if it is a `USD` stablecoin other than MACH. The plugin's `relay` skips the allowance, and a sponsoring `transport` does not. Outside a page, which has no payment page, the access key sends any amount within the whole limit, as before. Before, a payment of the whole limit, such as `'100'` with a 100 OUSD limit, passed the fill, then reverted on chain, since the fee spends the same limit. The user paid the fee, and the call rejected without the payment page. Such a payment now opens the payment page.

```ts
const accounts = Accounts.create({
  accessKey: { expiry: '1d', limits: [{ limit: '100', token: 'ousd' }] },
  plugins: [viem()],
})

// The payment page takes it, since the fee would exceed the limit.
await accounts.pay({ amount: '100', to, token: 'ousd' })
```
