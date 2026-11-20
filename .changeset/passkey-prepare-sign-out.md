---
'accounts': patch
---

Fixed `passkey.prepare`: a handle prepared while a user was signed in kept options that named only that user's passkeys, so after a `signOut`, here or in another tab, another user's `signIn` with the same handle found no passkey. The handle's next `signIn` after a sign-out now requests options of its own, which offer every passkey.
