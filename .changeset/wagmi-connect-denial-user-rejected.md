---
'accounts': patch
---

Fixed the `tempoId` connector's `connect` and `eth_requestAccounts` for a denied sign-in. If the user denies the request, such as with Deny on the approval page or for a device code, they throw Viem's `UserRejectedRequestError`, with `code` 4001 and the `access_denied` `Accounts.RequestError` as `cause`, as for a closed dialog. Before, they threw the `Accounts.RequestError`, which wagmi and EIP-1193 do not read as a refusal. A refusal of Tempo ID with a `reason`, such as `foreign_account`, stays an `Accounts.RequestError`.

A device grant's poll keeps the `reason`, `field`, and message of a refusal with `access_denied` or `expired_token` that carries a `reason`, so the connector does not read it as the user's denial.
