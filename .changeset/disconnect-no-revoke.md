---
'accounts': patch
---

Removed the revocation that `connection.disconnect` sent after the disconnection. Tempo ID revokes the app's tokens at the disconnection, so the sign-out after it sends no `POST /oauth2/revoke` for the session's refresh token. A disconnection now sends one request.

```ts
await accounts.connection.disconnect() // POST /v1/connection/disconnect
```
