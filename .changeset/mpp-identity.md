---
'accounts': patch
---

Added `identity` to the `mpp` plugin. With `identity: { scope }`, each request to an origin of `scope` carries the session's access token, a DPoP proof for a DPoP token, and the ID token, for an endpoint that verifies Tempo ID with mppx's `mppx/extensions/identity/tempo`. The plugin needs mppx 0.19.0 or later.

```ts
const accounts = Accounts.create({
  plugins: [dialog(), mpp({ identity: { scope: ['https://api.example.com'] } })],
})
```
