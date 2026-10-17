---
"accounts": patch
---

Treat a retried `eth_sendRawTransaction` or `eth_sendRawTransactionSync` that the node rejects with `already known` or `nonce too low` as successful when the node knows the transaction's hash. viem's transports retry a submission after a timeout, a network error or a 5xx response, so a transaction that landed on the first attempt could previously fail the send.
