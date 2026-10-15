---
"accounts": minor
---

Add an optional `chainId` to `wallet_revokeAccessKey` so callers can revoke an access key on a specific chain. The provider, the Privy adapter and the CLI adapter revoke on that chain and reject a chain the provider is not configured for. Omitting `chainId` keeps revoking on the active chain.
