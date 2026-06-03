---
"accounts": minor
---

Add provider-owned RPC action handling for adapters that expose a viem account with `getAccount`.

Adapters can now implement `getAccount` and optional `generateAccessKey` instead of duplicating transaction, signing, and access-key RPC actions.
