---
'accounts': patch
---

Changed the dialog of `accounts.pay`, `accounts.funding.open`, `dialog.updateAccessKey`, and `dialog.revokeAccessKey` to open the popup that Tempo ID's page in the frame requests at once while the page holds the user's click, in place of the offer to continue in a Tempo ID window. In a browser without IntersectionObserver v2, such as Safari, a payment that a plugin takes as `attempt` for an app that Tempo ID does not trust now opens the popup once the attempt sends nothing, within the same click, in place of the frame's offer.
