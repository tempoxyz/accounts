---
"accounts": patch
---

Made `wallet_revokeAccessKey` on the local adapter send a `revokeKey` transaction to the AccountKeychain precompile via `Actions.accessKey.revoke` before removing the key from the local store.
