---
'accounts': minor
---

**Breaking:** Renamed `Handler.webAuthn` option `challengeTtl` to `ttl.challenge`.

```diff
  Handler.webAuthn({
    kv,
    origin: 'https://example.com',
    rpId: 'example.com',
-   challengeTtl: 600,
+   ttl: { challenge: 600 },
  })
```

