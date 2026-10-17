---
"accounts": patch
---

`Handler.relay` answers `eth_fillTransaction` in fewer sequential RPC rounds. It simulates the requested calls alongside the fill instead of after it, and reuses that simulation unless a swap was prepended. It skips `tempo_simulateV1` for 10 minutes after the node reports it unsupported. The autoSwap balance check reuses the fee-token balance already read during fee-token resolution.
