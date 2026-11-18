---
'accounts': patch
---

**Breaking:** The `email` plugin types the parameters of `email.sendCode` and `email.signIn` per mode, as `email.sendCode.Backend | email.sendCode.Page` and `email.signIn.Backend | email.signIn.Page`. Only `Page` takes `link` and `registration`, and only `Backend` takes `userIp`, so a call that passes `userIp` beside `link` or `registration` does not compile.

```diff
 // On the app's page, which sends no `userIp`:
-const session = await accounts.email.signIn({ code, email, link, userIp })
+const session = await accounts.email.signIn({ code, email, link })

 // On a backend, which takes no `link` and no `registration`:
-const session = await accounts.email.signIn({ code, email, link, userIp })
+const session = await accounts.email.signIn({ code, email, userIp })
```
