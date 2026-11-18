---
'accounts': patch
---

`redirect.signIn` with `open` requests `prompt=login` when it starts in the same tick as `signOut`, also after a preset such as `expo`. It reads the instance's sign-out flag after its store reads, so the `beforeSignOut` hook of `redirect` sets it first.
