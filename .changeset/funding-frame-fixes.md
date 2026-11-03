---
'accounts': patch
---

Fixed `Actions.funding.open` in `frame` mode: an abort while the dialog loads now rejects the call, a later document in the frame that shows no deposit page offers the popup, and the frame can no longer navigate the app's page.
