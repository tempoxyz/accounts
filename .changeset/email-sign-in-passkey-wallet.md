---
'accounts': patch
---

Added the passkey account of a new user to `email.signIn` with an access key. When the user holds no account and the app's first account is a passkey, Tempo ID returns the wallet's registration in place of the authorization, and the call registers the passkey, whose proof signs the access key. Before, the sign-in threw `rejected`, and the page had to call `passkey.register` itself. The email plugin takes `createFn` for the creation ceremony.

```ts
// A new user creates their passkey, which signs the access key, and the session holds it.
const session = await accounts.email.signIn({ accessKey: { expiry: '1d' }, code, email })
```
