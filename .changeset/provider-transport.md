---
'accounts': patch
---

Added provider transport to `getClient()` so viem actions route through the provider adapter. Accepted standard `to`/`data` fields in `eth_sendTransaction` and converted them to Tempo `calls` format.
