---
'accounts': patch
---

Changed the `tempoId` connector's read of the Tempo Account of a session without an address. An access token that expires within 5 seconds now refreshes before the read. If the access token is a DPoP token, and the instance holds no DPoP key or another DPoP key than the one that binds it, the read throws `invalid_dpop_proof` without a request. Before, the read sent the held token until its expiry, and sent a DPoP token as a Bearer token, which Tempo ID refused with `invalid_token`.
