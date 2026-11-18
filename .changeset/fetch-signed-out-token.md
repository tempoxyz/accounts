---
'accounts': patch
---

Fixed `accounts.session.fetch`, `connection.get`, and `connection.disconnect` after another context on the store, such as another tab, signs out or signs in another user before the refresh of an expiring access token reads the store. They throw `Accounts.SignedOutError` and send no request, in place of a request with the signed-out access token.

```ts
const response = await accounts.session.fetch({ url: '/api/me' }).catch((error) => {
  if (error instanceof Accounts.SignedOutError) return showSignIn()
  throw error
})
```
