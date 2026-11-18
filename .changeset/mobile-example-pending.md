---
'example-mobile': patch
---

Fixed the mobile example showing "Sign in with Tempo" to a returning user while `accounts.useSession()` restores the session from the secure store. The app now renders nothing while `isPending`, as the mobile guide shows.
