---
"accounts": minor
---

Add an optional `chainId` to `wallet_revokeAccessKey` so callers can revoke an access key on a specific chain. The provider rejects a chain it is not configured for. Local, Privy, dialog, device-code (including CLI), postMessage and mobile web auth revocations target that chain and remove the local key for it only after the revocation succeeds. Other JSON-RPC adapters reject a `chainId` other than the active chain. Omitting `chainId` keeps revoking on the active chain.
