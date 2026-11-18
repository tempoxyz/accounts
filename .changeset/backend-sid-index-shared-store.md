---
'accounts': patch
---

Added `lock` to `Store`, and set it in `Store.memory`. It runs a function after each earlier call of the same key settles, also of other instances on the store. The `backend` plugin writes the logout index of each `sid` under it. Before, two instances on one `Store.memory` that signed in sessions of one `sid` at the same time lost one index entry, and a logout token then ended only one of the sessions.

```ts
const store = Store.memory()
const accounts = Accounts.create({ clientId, plugins: [backend({ store })] })
const other = Accounts.create({ clientId, plugins: [backend({ store })] })
// A logout token of the `sid` ends the sessions that both instances saved.
```
