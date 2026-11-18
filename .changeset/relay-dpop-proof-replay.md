---
'accounts': patch
---

Changed the `relay` plugin's route to refuse a repeated DPoP proof. A proof signs no body, so a captured request and its proof relayed any body again until the proof expired. The route now accepts each proof once in its process, and returns 401 with the reason `invalid_dpop_proof` for a repeated one, an expired one, or one whose `jti` exceeds 256 characters. While one DPoP key holds 1,000 unexpired proofs, its new one returns 429 with the reason `rate_limited`, and while the process holds 100,000, a new one returns 503 with the reason `temporarily_unavailable`.

```ts
const response = await accounts.relay.fetch(replayed)
response.status // 401
```
