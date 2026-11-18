---
'accounts': patch
---

Fixed `Actions.redirect.start` and the `redirect` plugin for several tabs of an app that sign in at once. Each redirect keeps its pending state in `store` under its own `state`, so a redirect that another tab starts no longer replaces it, and each tab's callback completes its own sign-in. Before, the first tab's callback failed with `invalid_request` on `state` after it redeemed the code.

```ts
const accounts = Accounts.create({ plugins: [redirect()] })
await accounts.redirect.signIn() // in two tabs: both complete
```
