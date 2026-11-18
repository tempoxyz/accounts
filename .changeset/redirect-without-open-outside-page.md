---
'accounts': patch
---

`redirect.signIn` without `open`, outside a page, such as in Node or React Native, throws a `TypeError` that says to pass `open`, before any request or store write. It threw `ReferenceError: window is not defined` after writing the PKCE verifier to the store, so a shared store, such as `Store.file`, kept a pending redirect that never left.

```ts
const accounts = Accounts.create({
  plugins: [redirect({ open: (url) => openSystemBrowser(url) })],
  redirectUri: 'com.example.app:/callback',
  store: Store.file('./session.json'),
})
```
