---
"accounts": patch
---

`Handler.relay` and `Handler.exchange` batch reads through Multicall3 at `0xcA11bde05977b3631167028862bE2a173976CA11` on Tempo mainnet, Moderato and devnet, which deploy it at genesis, instead of deployless calls that carry its ~6.6 KB of bytecode in every `eth_call`. Chains without a known Multicall3 still use deployless calls, and a chain that declares its own `contracts.multicall3` keeps it. The relay's fee-pool reads now batch with its other reads (`Actions.amm.getPool` always sent deployless calls and also read each pool's LP supply), and the relay batches up to 16 KB of calldata per call instead of 1 KB, so one fill's reads no longer split into several calls that queue behind a Worker's six connections.
