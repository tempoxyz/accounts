---
'accounts': minor
---

**Breaking:** Updated `wallet_deposit` params to use `amount` and `token` and removed `value`.

```diff
provider.request({
  method: 'wallet_deposit',
- params: [{ value: '25' }],
+ params: [{ amount: '25', token: 'pathUSD' }],
})
```
