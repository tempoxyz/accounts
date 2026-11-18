---
'accounts': patch
---

Typed the Tempo fields of the `viem` plugin's actions, such as `calls` and `feeToken`. `accounts.sendTransaction({ calls })` and `accounts.sendTransactionSync({ calls })` compile, and the access key signs the calls as one transaction. Before, the client's type named no Tempo chain, so TypeScript refused `calls` without a `chain` of `viem/tempo/chains` in the call.
