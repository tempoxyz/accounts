---
'accounts': patch
---

Instances on the same store object now hear each other's sign-in and sign-out where no page's `BroadcastChannel` exists, such as in React Native or Node, so another instance's `session.get` returns `undefined` right after a sign-out.
