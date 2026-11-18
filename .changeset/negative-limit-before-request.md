---
'accounts': patch
---

Fixed the refusal of a negative `accessKey.limits` entry, as a decimal string or in base units. Each sign-in throws `Accounts.RequestError` with the reason `invalid_field`, status 0, and the limit's `field` before the request that carries the access key. Before, the sign-in threw a hex encoder's integer range error, with no `reason`.

```ts
await accounts.dialog.signIn({
  accessKey: { expiry: '1d', limits: [{ limit: '-1', token: 'ousd' }] },
}) // throws invalid_field
```
