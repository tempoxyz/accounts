---
'accounts': minor
---

**Breaking:** Changed `Handler.webAuthn`'s `onAuthenticate` hook rejection status from `400` to `401` when the hook throws.

```diff
  // POST /login response when `onAuthenticate` throws `new Error('blocked')`:
- HTTP/1.1 400 Bad Request
+ HTTP/1.1 401 Unauthorized
  Content-Type: application/json

  {"error":"blocked"}
```

