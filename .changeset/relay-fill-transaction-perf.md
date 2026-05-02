---
'accounts': patch
---

Optimized `Handler.relay`'s `eth_fillTransaction` path with a speculative sponsored fill (skipping fee-token resolution when the sponsor accepts), KV-cached `Actions.fee.getUserToken` lookups, and a `capabilities.balanceDiffs: false` opt-out that skips the post-fill `tempo_simulateV1` round trip.
