---
'accounts': patch
---

Changed the `viem` plugin's retry to cover a call that names the client's own account, as Viem's standalone actions and wagmi's actions do. Before, a wagmi send over a spent limit rejected with `SpendingLimitExceeded`, and no sign-in for a new access key showed.
