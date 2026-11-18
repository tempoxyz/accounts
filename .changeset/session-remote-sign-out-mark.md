---
'accounts': patch
---

After another tab's sign-out without `everywhere`, the instance holds the signed-out mark, as after its own. A mount of `accounts.useSession()` and `accounts.session.get({ reauthorize })` then keep the status `signedOut`, with no change to `pending`, and read nothing from `store`. Another tab's sign-out with `everywhere` keeps the mark of an earlier sign-out in the instance.
