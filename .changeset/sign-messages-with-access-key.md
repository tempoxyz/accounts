---
'accounts': patch
---

Changed who signs a message and typed data on a page. The session's access key signs them at once, as it does outside a page. Before, the `viem` plugin and the `tempoId` wagmi connector signed as the account's owner until the access key's first transaction registered it on the chain. A verifier accepts the access key's signature only while the chain holds the access key, so an app sends a transaction before a signature that a verifier checks. The account's owner still signs for a session without an access key that signs on the client's chain. `Actions.account.signMessage` and `Actions.account.signTypedData` of `accounts/internal` sign as the account's owner.
