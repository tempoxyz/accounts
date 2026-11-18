---
'accounts': patch
---

Fixed a page whose store is local, such as `Store.memory`, which kept its session after another tab's `signOut` with `everywhere`. The logout revokes the tokens of the browser's Tempo ID session, also the copy that a local store holds, so `session.status` showed `signedIn` until a refresh failed with `invalid_grant`. The tab now signs out at once, empties its store, and sends no request.

```ts
const accounts = Accounts.create({ store: Store.memory() })
// Another tab: await accounts.signOut({ everywhere: true })
accounts.session.status.get().status // 'signedOut'
```
