---
'accounts': patch
---

Changed `device.signIn` to end at a sign-out of the instance that overtakes it, also while its code request or `onCode` is pending, and to throw `Accounts.SupersededError`. Before, it polled until the user approved the code or the code expired. Added `signal` to the `wait` of `Actions.device.authorize`.
