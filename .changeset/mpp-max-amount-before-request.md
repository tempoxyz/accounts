---
'accounts': patch
---

Fixed `mpp`'s `maxAmount` check. A `maxAmount` that is no decimal amount of 0 or more, such as `''` or `'-1'`, throws the new `mpp.MaxAmountInvalidError`, and one with more than 6 decimals throws `mpp.MaxAmountPrecisionError`, before any request. Before, the payer sent the unpaid request first, then threw ox's `Value.InvalidDecimalNumberError`, or refused even a free proof with `mpp.MaxAmountError`.

```ts
await accounts.mpp({ maxAmount: '' }).fetch(url) // throws mpp.MaxAmountInvalidError, sends nothing
```
