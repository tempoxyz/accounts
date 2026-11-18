---
'accounts': patch
---

Fixed the request of a DPoP token that the instance's `dpop` key does not bind. `Actions.fetch`, `Actions.oauth.userInfo`, the `Actions.account` reads and revocations, and `account.get` with `accessToken` throw `Accounts.RequestError` with the reason `invalid_dpop_proof`, and send no request, as `session.fetch` does. Before, an instance without a key sent the DPoP token with the `Bearer` scheme, and an instance with another key sent a proof of that key, which every API refuses.

```ts
await Actions.fetch(auth, { accessToken, url: 'https://api.example/me' })
```

The read of an access token's claims skips a payload outside base64url, so a token with a long run of `=` takes linear time to refuse.
