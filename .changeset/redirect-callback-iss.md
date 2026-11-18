---
'accounts': patch
---

Fixed `Actions.redirect.complete` and the `redirect` plugin to remove the callback's `iss` parameter (RFC 9207) from the address bar, with `code` and `state`. Before, the page kept `?iss=…` after the sign-in, and each app removed it with its own `history.replaceState`.

```ts
const accounts = Accounts.create({ plugins: [redirect()] })
await accounts.session.get() // on the callback page: the address bar holds no callback parameter
```
