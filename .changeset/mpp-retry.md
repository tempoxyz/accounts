---
'accounts': patch
---

Added the retry of the `viem` plugin to the `mpp` plugin's payments on a page. A charge, a session manager's request, stream, or top-up, and a subscription of an account whose balance is too low now show Tempo ID's deposit page in a frame, and pay again once a deposit arrives. A charge also signs in for a new access key after a spent limit, or for an access key that the chain does not hold. A subscription reads the balance before the dialog opens, and rejects with the new `mpp.BalanceError` if a deposit leaves it too low. Added the `retry` option to `mpp()` and to the overrides of `accounts.mpp()`, which defaults to the `viem` plugin's `retry`.
