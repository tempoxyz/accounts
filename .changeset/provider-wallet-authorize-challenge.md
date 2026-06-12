---
"accounts": patch
---

Added the `wallet_authorizeChallenge` RPC method — creates a Machine Payment Protocol credential for a serialized challenge, advertised via the `mpp` capability on `wallet_getCapabilities`. Rejects as unsupported when MPP is disabled so clients can fall back to local signing.

Added `provider.mpp` — the payment-aware `fetch` and configured MPP method clients, for runtimes where the global `fetch` polyfill is unavailable (e.g. Cloudflare Workers). `undefined` when MPP is disabled.
