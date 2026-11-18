---
'accounts': patch
---

Raised the `viem` peer range to `^2.57.19`. With it, `Actions.accounts.getConfigCommitment` returns the zero commitment on a chain without the configurable account precompile, and Viem's `verifyHash`, `verifyMessage`, and `verifySiweMessage` read the account's config commitment and refuse a retired root key's signature. The access key of a session signs a hash, a message, and typed data in a keychain envelope without its key authorization, as before, also where Viem wraps the envelope with the authorization (TIP-1165).
