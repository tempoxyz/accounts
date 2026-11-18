---
'accounts': patch
---

Added `Accounts.RedirectUriRequiredError`. `backend.start` and `redirect.signIn` throw it outside a browser, before any request or store write, when no `redirectUri` names the return, on the instance or on the call of `backend.start`, also through `Sessions.durableObject`, whose RPC carries it as its class. Before, they threw `ReferenceError: window is not defined` on a server, or a `TypeError` on React Native's `window` without `location`.

```ts
await accounts.backend.start() // throws Accounts.RedirectUriRequiredError
await accounts.backend.start({ redirectUri: 'https://app.example/callback' })
```
