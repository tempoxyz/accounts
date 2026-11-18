---
'accounts': patch
---

Changed the message of `Accounts.RequestError` for a callback `error` without `error_description`, such as the Cancel of an access key page in `updateAccessKey` and `revokeAccessKey`. `access_denied` and `login_required` state the fault and the fix, and any other code names itself with the fix. Before, the message was the bare code, such as `access_denied`.

```ts
const error = await accounts.dialog.updateAccessKey({ limits }).catch((error) => error)
error.message // 'The user denied the request. Start the request again to ask once more.'
```
