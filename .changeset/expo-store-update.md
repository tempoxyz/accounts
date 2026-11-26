---
'accounts': patch
---

Fixed the store of `accounts/expo` to keep the sign-out flag of an instance that signs out while another instance's `redirect.signIn` removes its own flag, so the next sign-in sends `prompt=login`. The store now sets `update`, which reads and writes a key while every other write of the key on the device waits.
