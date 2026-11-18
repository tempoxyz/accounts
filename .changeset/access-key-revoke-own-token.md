---
'accounts': patch
---

`accessKey.revoke` and `accessKey.revokeSync` of an access key that the instance's session holds send the session's access token to `POST /v1/access-keys/revoke`. Any app thus revokes its own access key with no page, also without the `tempo-id:sign` scope, which refused it with `sign_not_permitted` before. Another access key, and `accessKey.updateLimit`, still need the scope.

```ts
const accessKey = (await accounts.session.get())?.accessKey?.keyAuthorization.keyId
if (accessKey) await accounts.accessKey.revokeSync({ accessKey })
await accounts.signOut()
```
