---
'accounts': patch
---

Fixed `passkey.register` in an instance that signed out, after another instance on the same store, such as another tab, signed the user in. The call reads the stored session, sets it as the instance's session, and registers the passkey. Before, it threw `session_required` until the instance read the store again, such as at a reload, and in Node, React Native, and Workers until a restart. A sign-out in progress in the instance settles before the read, so the call never restores the session that the sign-out ends.

```ts
await tab1.signOut()
await tab2.passkey.signIn()
await tab1.passkey.register() // registers the passkey for the user who signed in
```
