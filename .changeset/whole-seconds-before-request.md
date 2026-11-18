---
'accounts': patch
---

Fixed the refusal of an access key `expiry` that is not a whole number of seconds, such as `Date.now() / 1000 + 3600`, and of a limit's `period` that is fractional or negative. Each sign-in throws `Accounts.RequestError` with the reason `invalid_expiry` or `invalid_period`, status 0, and the `field` before the request that carries the access key. Before, the request reached Tempo ID, and a redirect sign-in left the page and returned with `invalid_authorization_details` and no `reason`.

```ts
await accounts.redirect.signIn({
  accessKey: {
    expiry: Date.now() / 1000 + 3600,
    limits: [{ limit: '10', token: 'ousd' }],
  },
}) // throws invalid_expiry
```
