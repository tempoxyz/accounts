---
'accounts': patch
---

**Breaking:** Read the next action of a Tempo ID response from `next`, which replaces `step` and `passkey_account`. `passkey.signIn` returns the email step as `{ next }` in place of `{ step }`. `email.signIn` creates a new user's passkey account from the `createOwner` action.
