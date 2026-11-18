---
'accounts': patch
---

Fixed an access key whose `expiry` in Unix seconds has passed, such as a lifetime of `3600` in place of `'1h'`. Every sign-in and authorization now throws `Accounts.RequestError` with `expiry_passed` and status 0 before the request that carries the access key, as Tempo ID refuses it. A renewal whose access key lifetime ended renews without that access key. Before, the request reached Tempo ID, and `passkey.register` and `passkey.signIn` refused only after it. The examples of `passkey` and `Actions.passkey.register` used `expiry: 3600`, and now use `'1h'`.

```ts
await accounts.passkey.register({ accessKey: { expiry: '1h' } })
```
