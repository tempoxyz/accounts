---
'accounts': patch
---

Each sign-in throws `Accounts.RequestError` with `invalid_expiry` and status 0 for an `accessKey.expiry` in milliseconds, such as `Date.now() + 3_600_000`, before any request or window. Before, a dialog or redirect sign-in sent it, and Tempo ID's page approved an access key that expires in the year 58,000 in place of an hour.

```ts
const accounts = Accounts.create({
  accessKey: () => ({
    expiry: Math.floor(Date.now() / 1000) + 3600, // or '1h'
    limits: [{ limit: '5', token: 'ousd' }],
  }),
})
```
