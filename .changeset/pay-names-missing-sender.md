---
'accounts': patch
---

Outside a page, `accounts.pay` on an instance without a plugin that sends payments, such as a native app without `viem()`, now throws `Actions.account.PageRequiredError` with a message that names the missing plugin, rather than one that asks for a sign-in for a larger access key. Added the `sender` option of `PageRequiredError`.
