---
'accounts': patch
---

`redirect.signIn` with `open` requests `prompt=login` when a sign-out runs at the call, also while the `beforeSignOut` hook of an earlier plugin runs, and opens the browser without waiting for the sign-out's revocation and logout. It reads the instance's sign-out count after its store reads, so a sign-in after such a sign-out removes the flag that it used, and the next sign-in requests no `prompt=login`.
