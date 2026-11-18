---
'accounts': patch
---

Fixed `funding.complete` and `Actions.funding.complete`, which returned any `deposit_amount` of the URL as `amount`, such as `abc` from a forged link. A `deposit_amount` that is not a decimal of the form that Tempo ID's return route sends, such as `25.5`, now returns no `amount`, and the result keeps `status: 'received'`.

```ts
accounts.funding.complete({ url: 'https://app.example/wallet?deposit_status=received&deposit_amount=abc' })
// { status: 'received' }
```
