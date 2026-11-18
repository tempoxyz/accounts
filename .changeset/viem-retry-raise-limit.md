---
'accounts': patch
---

Changed the `viem` plugin's `limit` retry to request a higher limit for a transaction above the whole limit of its token, which Viem's `AccessKeySpendingLimitExceededError` names. The sign-in requests a new access key whose limit of the token is the old limit plus the refused amount, and the transaction then sends again. Before, the transaction rejected with that error, and showed no sign-in. A spend of a `USD` token within 0.1 of the whole limit requests the old limit plus 0.1, since the limit of a token that pays the fee also pays it, unless `relay` pays the fees. A transfer that joins the sign-in of another transfer, whose new limit is below its amount, signs in again from the new access key. A call above the whole limit without that error, such as a mint, still rejects with its error.
