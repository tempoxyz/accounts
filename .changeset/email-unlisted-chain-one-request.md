---
'accounts': patch
---

`email.signIn` sends one request on a chain that Tempo ID does not list, for 10 minutes after Tempo ID refused that chain for the instance. Tempo ID refuses an unlisted `account.chain` before it spends the code, so each such sign-in sent `POST /v1/auth/code/verify` twice. `Actions.email.signIn` takes `chainListed: false`, which sends no chain, and returns `chainListed: false` where Tempo ID refused the chain.

```ts
const result = await Actions.email.signIn(auth, { code, email })
// A later sign-in on the same chain sends one request.
await Actions.email.signIn(auth, { chainListed: result.chainListed, code: next, email })
```
