---
'accounts': patch
---

Fixed the renewal of an expired access key that the app supplied to its sign-in, by its `publicKey` or as a Viem `account`. `session.get` with `reauthorize` and `authorize` requested a new access key in its place, which the app never held, and saved it for the session. The renewal now sends no request: `session.get` returns `undefined`, so the page signs in again with the app's access key, and `authorize` throws `Accounts.RequestError` with the reason `missing_key`.

```ts
const session = await accounts.session.get({ reauthorize: true })
if (!session) await passkey.signIn({ accessKey: { publicKey, expiry: '1h' } })
```
