---
'accounts': minor
---

Added `accounts.pay` and `Actions.account.pay`, which request one payment from the user's Tempo Account on Tempo ID's payment page, in a frame in a dialog or in a popup window, and resolve with the hash of the transaction.

With the `viem` plugin, `accounts.pay` sends its transfer with the session's access key in place of the page, if the access key signs on the chain and its limits hold the amount. On a page, `token.transfer` and `token.transferSync` of a session without an access key send through the payment page.

With the `mpp` plugin, `accounts.fetch` pays a charge that no access key pays on the payment page, in a browser: a charge of a session without an access key, or a charge outside the access key's limits.
