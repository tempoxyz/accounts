---
'accounts': patch
---

Fixed the refusal of every DPoP token request from a device whose clock runs more than 5 seconds ahead of Tempo ID's. Each DPoP proof for Tempo ID's origin sets its `iat` 60 seconds before its signature, so a code redemption, a refresh, and a request to Tempo ID's routes with a DPoP token succeed from a device clock up to 65 seconds fast. A proof for an app's own API keeps the device's current time, so a verifier with a short window still accepts it. `Dpop.proof` takes `issuer: true` for such a proof. Before, Tempo ID refused each of them with `invalid_dpop_proof`, and the user could not sign in or refresh.

```ts
const accounts = Accounts.create({ dpop: await Dpop.create() })
```
