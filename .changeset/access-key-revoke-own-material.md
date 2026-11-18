---
'accounts': patch
---

`accessKey.revoke` and `accessKey.revokeSync` of the session's own access key drop its private key from the session and its store once Tempo ID revokes it. As for another app's access key, the next transaction throws `Accounts.AccessKeyRequiredError` instead of the node's `AccessKeyError`, and on a page a `token.transfer` opens Tempo ID's payment page. `Store.file` keeps no private key that signs nothing.

```ts
await accounts.accessKey.revokeSync({ accessKey })
await accounts.viem.sendTransactionSync(parameters) // rejects with Accounts.AccessKeyRequiredError among its causes
```
