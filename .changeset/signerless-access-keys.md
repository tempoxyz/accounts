---
'accounts': patch
---

Added `publicKey` and `type` to a low-level action's `accessKey`, which authorize an access key whose private key the page does not hold.

```ts
const authorization = await Actions.dialog.signIn(config, {
  accessKey: { limits, publicKey },
})
```
