---
'accounts': patch
---

Fixed the error of `session.accessToken` and `session.fetch` for an expired access token whose refresh token Tempo ID refuses, such as a revoked one. The call throws `Accounts.SignedOutError`, as the calls after it do, since the refusal empties the session. Its `cause` is Tempo ID's `Accounts.RequestError`, with the code `invalid_grant`. `Accounts.SignedOutError` takes a `cause` option. Before, the first call threw `Accounts.RequestError` with the code `invalid_grant` and no `reason`.

```ts
await accounts.session.fetch({ url: 'https://api.example.com/me' })
// throws Accounts.SignedOutError, whose cause is the RequestError of invalid_grant
```
