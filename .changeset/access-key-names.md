---
'accounts': patch
---

Renamed `Actions.account.revokeKey` and `updateKey` to `revokeAccessKey` and `updateAccessKey`, and the access key fields `key` and `keys` of the JSON API to `accessKey` and `accessKeys`.

```diff
- await Actions.account.revokeKey(auth, { accessKey, account })
+ await Actions.account.revokeAccessKey(auth, { accessKey, account })
```
