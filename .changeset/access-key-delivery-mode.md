---
'accounts': patch
---

**Breaking:** `Actions.account.revokeAccessKey` and `Actions.account.updateAccessKey` take `mode: 'iframe' | 'popup' | 'redirect' | 'request'`, which replaces `dialog` and `redirect: true`. Each mode takes only its own options: `redirectUri` and `signal` with `iframe` and `popup`, and `redirectUri` and `state` with `redirect`. With `request`, the default, `revokeAccessKey` takes `accessToken`, and `updateAccessKey` takes no option of its own. The return type follows `mode`.

```diff
 const { url } = await Actions.account.updateAccessKey(auth, {
   accessKey,
   account,
   chainId,
-  redirect: true,
+  mode: 'redirect',
   state,
 })

 const { transaction } = await Actions.account.updateAccessKey(auth, {
   accessKey,
   account,
   chainId,
-  dialog: 'popup',
+  mode: 'popup',
 })
```
