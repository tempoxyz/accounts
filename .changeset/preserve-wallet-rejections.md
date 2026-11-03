---
"accounts": patch
---

A wallet's user rejection (`4001`) of `eth_sendTransaction`, or of `wallet_sendCalls` without `sync`, now reaches the app as `4001`. viem's `sendTransaction` wraps the wallet's error in a `TransactionExecutionError`, which has no code, so the provider reported the rejection as an internal error (`-32603` "User rejected the request."). The provider now surfaces an EIP-1193 provider error (for example `4001` or `4100`) that a viem action wrapped. Other wrapped errors are unchanged.
