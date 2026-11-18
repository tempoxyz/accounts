---
'accounts': patch
---

Changed the `viem` plugin's transactions to wait for the store's read of the access key's registration mark that is in progress. Before, a new instance on a remote store, such as `Store.redis`, sent its first transaction before the read returned, attached the key authorization again, and the node's refusal added 5 RPC requests.
