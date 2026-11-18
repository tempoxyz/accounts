---
'accounts': patch
---

Fixed the registration marks of the `viem` plugin, which stayed in the store after their access key left the session. A sign-out, or a sign-in with another access key, now deletes the mark of each access key that the instance's session no longer holds. Before, a store that keeps entries past their `expiresAt`, such as IndexedDB or the secure store of `expo`, kept one mark for each access key for good.

```ts
await accounts.signOut() // Also deletes `tempo-id:registered:[…]` of the session's access keys.
```
