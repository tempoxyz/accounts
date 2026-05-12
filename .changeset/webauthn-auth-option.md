---
'accounts': patch
---

Added `auth` option to the `webAuthn` adapter, mirroring the Provider `auth` capability shape (`string | { url, ... }`); the existing `authUrl` option is preserved as a deprecated alias.

```diff
- webAuthn({ authUrl: '/webauthn' })
+ webAuthn({ auth: '/webauthn' })
```
