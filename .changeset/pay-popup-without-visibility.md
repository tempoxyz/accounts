---
'accounts': patch
---

Changed `accounts.pay`, `dialog.updateAccessKey`, and `dialog.revokeAccessKey` in a browser without IntersectionObserver v2, such as Safari. As a sign-in does, a call within a click now opens the popup at once for an app that the dialog's preloaded frame reports as untrusted, in place of the frame's offer to continue in a Tempo ID window. A trusted app keeps the frame, as do a payment that a plugin takes, a call outside a click, and a call before the frame reports.
