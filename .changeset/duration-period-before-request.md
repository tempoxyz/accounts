---
'accounts': patch
---

Fixed the refusal of a limit's `period` as a duration above `Number.MAX_SAFE_INTEGER` seconds, such as `'9007199254740993s'`. Each sign-in throws `Accounts.RequestError` with the reason `invalid_period`, status 0, and the `field` before the request that carries the access key, as it does for the same period as a number. Before, the request held a rounded period, `null`, or a period in exponent notation.

```ts
await accounts.redirect.signIn({
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', period: '9007199254740993s', token: 'ousd' }],
  },
}) // throws invalid_period
```
