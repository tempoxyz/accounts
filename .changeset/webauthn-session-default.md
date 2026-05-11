---
'accounts': minor
---

**Breaking:** Made `Handler.webAuthn` issue a session cookie and persist a session entry under `session:<token>` in `kv` on successful `/login` by default -- opt out via `session: false` or `cookie: false`.

```diff
  // Default behavior -- `/login` now sets a cookie and writes to kv.
  Handler.webAuthn({ kv, origin, rpId })

  // Pre-PR behavior (no cookie, no kv session writes, no `/logout`):
+ Handler.webAuthn({ kv, origin, rpId, session: false })

  // Or just disable cookie issuance and return the token in the body:
+ Handler.webAuthn({ kv, origin, rpId, cookie: false })
```

