---
'accounts': patch
---

Outside a page, `accounts.pay` throws `Actions.account.PageRequiredError` when the node refuses the session's access key's payment for a spent limit, a call outside its scopes, or an access key that the chain does not hold, with the refusal as its `cause`, as it does for a payment above the access key's known limits. It threw Viem's error before. A low balance still throws Viem's error.
