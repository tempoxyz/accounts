---
'accounts': patch
---

Added `hooks` to the `session.reload` of a plugin's context. With it, an adoption of a stored session where the instance held none, or another user's, runs the plugins' `afterSignIn` hooks. The `tempoId` connector's `connect` and wagmi's `reconnect` outside a page pass it, so they run the hooks for a session that another instance saved to a shared store. Other reloads, such as the one before an authorization's commit, run none, since the commit runs them.

```ts
await context.session.reload({ hooks: true })
```
