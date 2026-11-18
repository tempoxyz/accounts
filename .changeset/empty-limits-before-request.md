---
'accounts': patch
---

Fixed the refusal of an empty `accessKey.limits` or `accessKey.scopes`. Each sign-in throws `Accounts.RequestError` with the reason `empty_limits` or `empty_scopes`, status 0, and the `field` before the request that carries the access key. Before, the request reached Tempo ID, and a redirect sign-in left the page and returned with `invalid_authorization_details` and no `reason`.

```ts
await accounts.redirect.signIn({
  accessKey: { expiry: '1d', limits: [] },
}) // throws empty_limits
```
