---
'accounts': patch
---

Added `json` to `Store`, which `Store.file`, `Store.postgres`, and `Store.redis` set. In a browser, a sign-in on an instance with such a store throws a `TypeError` before any request, since JSON has no form of the page's non-extractable access key. Before, `email.signIn` sent the code, Tempo ID spent it, the save of the session failed with the same `TypeError`, and the instance revoked the new refresh token, so the user needed a new code.

```ts
const accounts = Accounts.create({
  plugins: [email()],
  store: Store.redis(client), // throws at email.signIn before the code request; omit for IndexedDB
})
```
