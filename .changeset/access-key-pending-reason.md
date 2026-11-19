---
'accounts': patch
---

Added the reason `access_key_pending` to `RequestError.Reason`. Tempo ID refuses a key authorization for an access key that has an unregistered key authorization with other limits or scopes. If Tempo ID refuses a redemption of `connections.connect` with this reason, the call drops the stored access key, so the next call sends a new one.

```ts
try {
  await accounts.connections.connect({ accessToken })
} catch (error) {
  if (error instanceof Accounts.RequestError && error.reason === 'access_key_pending') {
    // The next call sends a new access key.
  }
}
```
