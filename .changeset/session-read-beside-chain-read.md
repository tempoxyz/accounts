---
'accounts': patch
---

Fixed the order of the reads of `accounts.session.get` and of each restore, such as `useSession`'s first render. The read of the stored session starts beside the read of the stored chain selection, so a restore waits for one round trip of the store. Before, the session's read started only after the selection's read settled, which added one round trip of the store, such as of `Store.postgres` or `Store.redis`, to each restore. A restore hook, such as a redirect's callback, still runs on the selected chain.

```ts
const session = await accounts.session.get()
```
