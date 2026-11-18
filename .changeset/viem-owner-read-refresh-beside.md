---
'accounts': patch
---

Fixed the account read of an owner's first signature, which waited for a refresh when the access token expired within 30 seconds. The read now sends the token that `session.accessToken` returns: a token that holds for over 5 seconds serves while the refresh runs beside it, so the signature waits for one round trip less. On a page, a DPoP token that the instance's `dpop` key does not bind now sends the session cookie in its place, as `account.get` does. Elsewhere, the signature throws the error of `session.accessToken`.

```ts
await accounts.viem.account.signMessage({ message: 'hello' })
```
