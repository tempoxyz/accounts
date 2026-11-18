---
'accounts': patch
---

Changed the `viem` plugin's `balance` and `limit` retries to run outside a page for an instance with the `device` plugin, such as a CLI's. In place of a screen, the retry starts a device grant for a new access key through the new `device.request`, and the plugin's `onCode` shows its code. `device.request` runs the grant of `device.signIn`, and returns the authorization without a session. A spent limit requests a higher limit, as on a page. A low balance carries a funding hint, so Tempo ID's device page opens the deposit page after the approval, and the transaction sends again once the balance holds the hint, within 10 minutes. A denied code rejects with `Plugins.viem.RetryClosedError`. Without the plugin's `onCode`, the transaction rejects with its own error. `device.request` and `device.signIn` without `onCode` throw `Plugins.device.OnCodeRequiredError`. Before, both refusals rejected with their errors outside a page.
