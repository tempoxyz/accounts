---
"accounts": minor
---

Added `wallet_authorizeAccessKey` support to the CLI adapter, allowing access keys to be authorized independently from `wallet_connect`. The `wallet_authorizeAccessKey` return type is now wrapped in a `{ keyAuthorization, rootAddress }` envelope.
