---
'accounts': patch
---

Fixed the `identity` option of the `mpp` plugin for an instance with a `dpop` key whose session holds a Bearer access token, such as one that the store saved before the app set its `dpop` key. Each request sent that token with the `DPoP` scheme and a proof, which an API that verifies Tempo ID tokens refuses. It now sends a Bearer token with the `Bearer` scheme and no proof, as `session.fetch` does, and a DPoP token with the `DPoP` scheme and a proof.
