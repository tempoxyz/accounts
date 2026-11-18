---
'accounts': patch
---

Fixed `authorize` after `session.get` emptied a session whose access key expired. On an instance without `accessKey`, the authorization now requests the expired access key's limits, scopes, and lifetime again, as a renewal does, in the same instance until a sign-in or a sign-out. A `switchChain` moves the expired session's access keys to the selected chain, so the renewal requests none on the chain that it left. Before, it authorized no access key, so the session signed no transactions.

```ts
const session = await accounts.session.get() // undefined: the access key expired
await accounts.authorize() // renews the access key of the sign-in
```
