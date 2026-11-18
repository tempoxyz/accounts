---
'accounts': patch
---

In a browser without IntersectionObserver v2, such as Safari or Firefox, `funding.open`, `accounts.pay`, `dialog.updateAccessKey`, and `dialog.revokeAccessKey` now open the popup at the click unless the dialog's preloaded frame reported that Tempo ID trusts the app, as a sign-in does. Before, an unknown trust, such as with `dialog({ preload: false })` or without the `dialog` plugin, kept the frame, which offered the popup only after the click.
