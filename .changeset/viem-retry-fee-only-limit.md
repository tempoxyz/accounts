---
'accounts': patch
---

Fixed the `viem` plugin's `limit` retry for a refusal without Viem's `AccessKeySpendingLimitExceededError`. Such a refusal can be one of the fee payment, so a spent limit that pays only network fees, such as an app's own limit of a stablecoin that no scope calls, now opens the sign-in for a new access key again. Before, the retry read no such limit, and the call rejected with its error.
