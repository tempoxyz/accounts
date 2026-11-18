---
'accounts': patch
---

Fixed `passkey.register` and `Actions.passkey.register` with `accessKey`: an authorization for another account than the new passkey's now revokes its refresh token before the call throws `server_error`. Before, that refresh token stayed valid, and no session held it.
