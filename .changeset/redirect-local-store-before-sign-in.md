---
'accounts': patch
---

`redirect.signIn` without `open` and `Actions.redirect.start` refuse a `store` that sets `local`, such as `Store.memory`, before any request. They throw `Accounts.RequestError` with `invalid_request`, the `field` `store`, and status 0. Before, the page left for Tempo ID's sign-in, and the user signed in and approved the access key. The return then threw `invalid_request`, since the page load emptied the store.

```ts
const accounts = Accounts.create({ plugins: [redirect()], store: Store.memory() })
await accounts.redirect.signIn() // throws invalid_request, field store, and stays on the page
```
