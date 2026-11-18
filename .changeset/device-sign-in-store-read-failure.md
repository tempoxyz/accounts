---
'accounts': patch
---

`device.signIn` rejects with the store's error before the code request when the read of the store fails, such as for a database that does not respond. Before, the sign-in showed the code, the user approved it, and the sign-in then rejected at the save of the session.

A stored chain selection that throws `Store.InvalidValueError`, such as a corrupt row of `Store.postgres`, keeps the configured chain, since the session saves under its own entry.
