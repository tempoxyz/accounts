---
'accounts': patch
---

Fixed `authorize` without a Tempo ID session in an instance that holds no session, such as at a signed-out page's load. It writes nothing to the store. Before, it saved an empty session, which erased another tab's sign-in that landed after its read of the store, and made each other tab take the lock and read the store again.

```ts
const session = await accounts.authorize() // undefined, and the store keeps another tab's sign-in
```
