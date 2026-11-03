---
"accounts": patch
---

Requests forwarded to the wallet through the `tempoWallet` (postMessage), `mobileWebAuth` and legacy `dialog` adapters are sent once. Their viem transports used viem's default of three retries, so a failed `eth_sendTransactionSync`, `wallet_authorizeAccessKey`, `wallet_revokeAccessKey` or `wallet_updateAccessKey` was sent to the wallet again with about a second of backoff: the approval reappeared, and a retry after an uncertain failure could send a second transaction. Adapters built on the shared request-forwarding core now default `retryCount` to `0`; the device-code and CLI adapters keep their explicit `retryCount` option.
