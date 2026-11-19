---
'accounts': patch
---

`redirect.signIn` sends the email of the last signed-in user as `login_hint` after the session expires, also after a restart of the app. The `store` keeps the email, and `signOut` removes it.
