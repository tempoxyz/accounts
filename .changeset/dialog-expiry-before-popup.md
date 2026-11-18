---
'accounts': patch
---

Fixed `dialog.signIn` for an access key whose `expiry` in Unix seconds has passed. The call now throws `expiry_passed` before the popup or the dialog opens. Before, `mode: 'popup'` opened a blank popup and the dialog that names it, then closed both and threw.

```ts
await accounts.dialog.signIn({ accessKey: { expiry: '1h' }, mode: 'popup' })
```
