---
"accounts": patch
---

`Handler.relay` probes `tempo_simulateV1` once, without retries. Public Tempo RPCs refuse the method with HTTP 403, which viem retried with backoff for about a second before the relay fell back to `eth_simulateV1`. A transport failure on the probe now falls back to `eth_simulateV1` (with retries) instead of failing the fill.
