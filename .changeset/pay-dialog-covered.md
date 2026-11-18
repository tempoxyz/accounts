---
'accounts': patch
---

Changed `accounts.pay` in a dialog to show the dialog at once, with the payment page's skeleton, while the access key sends. If the access key sends, the dialog closes and the call returns the payment. Otherwise, the payment page shows in the same dialog. Added the `attempt` option to `Actions.account.pay`: a promise of the payment that an access key sends, or `undefined` if it sends none.
