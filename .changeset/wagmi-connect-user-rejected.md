---
'accounts': patch
---

Fixed the `tempoId` connector's `connect` and `eth_requestAccounts` for a closed sign-in. If the user closes the dialog or the popup, they throw Viem's `UserRejectedRequestError`, with `code` 4001 and the `AbortError` as `cause`, as wagmi's other connectors do. Before, they threw the `AbortError`, which wagmi and EIP-1193 do not read as a refusal.
