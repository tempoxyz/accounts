---
'accounts': patch
---

Changed `dialog.signIn` and `dialog.signMessage` on a page on `http:`, such as `http://localhost`, to run in a popup, as version 0's dialog did. Such a page is a secure context, so it framed Tempo ID's sign-in before. The page now preloads no frame, and `mode: 'iframe'` runs as `popup` there. A page on `http:` keeps the frame for a Tempo ID on `http:`, such as a local one.

```ts
// On `http://localhost:5173`, the sign-in opens in a popup.
button.onclick = () => accounts.dialog.signIn()
```
