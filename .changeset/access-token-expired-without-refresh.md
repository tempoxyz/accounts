---
'accounts': patch
---

Fixed `session.accessToken` and `session.fetch` for a session without a refresh token, such as from a sign-in without `offline_access`. If its access token expired, the call throws `Accounts.SignedOutError` and sends no request. Before, it returned the expired access token, and `session.fetch` sent it, which every API refuses.

```ts
await accounts.session.fetch({ url: 'https://api.example.com/me' }) // throws Accounts.SignedOutError
```
