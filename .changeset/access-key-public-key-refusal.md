---
'accounts': patch
---

Fixed the refusal of an `accessKey.publicKey` that holds no uncompressed public key, such as a private key in its place. `passkey.signIn`, `passkey.register`, and every other sign-in with `publicKey` throw `Accounts.RequestError` with the reason `invalid_public_key` before any request, and the error quotes none of the value. Before, the parser's error quoted the whole value in its message, so a private key passed by mistake reached the app's logs.

```ts
await accounts.passkey.signIn({ accessKey: { expiry: 3600, publicKey } })
```
