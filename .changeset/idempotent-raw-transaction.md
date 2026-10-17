---
"accounts": patch
---

Treat a retried `eth_sendRawTransaction` or `eth_sendRawTransactionSync` that the node rejects with `already known` or `nonce too low` as successful when the node knows the transaction's hash. viem's transports retry a submission after a timeout, a network error or a 5xx response, so a transaction that landed on the first attempt could previously fail the send.

An access-key send that times out or loses its response no longer falls back to signing the same calls with the root account, which could send them twice.
