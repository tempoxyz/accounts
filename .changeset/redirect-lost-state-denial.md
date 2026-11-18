---
'accounts': patch
---

Fixed a denial at the return of a redirect whose state a custom `store` lost, such as one that a page load empties. `session.get()` on the callback's page throws the callback's `error`, such as `access_denied`, and removes the callback's parameters from the URL. Before, it treated the callback as a page load without one, so the plugin restored the session from Tempo ID's own, and the user who denied the sign-in was signed in.

```ts
const accounts = Accounts.create({ plugins: [redirect()], store })
await accounts.session.get() // throws Accounts.RequestError with the code `access_denied`
```
