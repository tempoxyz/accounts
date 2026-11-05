---
'accounts': patch
---

Added `accounts` to the result of `email.signIn`: every Tempo Account of the user in the app's realms, the session's account first. Added `account` to `accounts.authorize`, which names the Tempo Account that the access key acts for.
