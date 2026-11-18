---
'accounts': patch
---

Added `access_key_changing` to `Accounts.RequestError.Reason`. Tempo ID refuses a change of an access key with it, with status 409, while another request changes the same limit or the scopes of that access key. `accessKey.updateLimit`, `accessKey.updateLimitSync`, and `Actions.account.updateAccessKey` throw it, and the change succeeds after the other request ends.

```ts
try {
  await accounts.accessKey.updateLimitSync({ accessKey, limit, token })
} catch (error) {
  if (error instanceof Accounts.RequestError && error.reason === 'access_key_changing') {
    // Another request changes the same limit. Send the change again after it ends.
  }
}
```
