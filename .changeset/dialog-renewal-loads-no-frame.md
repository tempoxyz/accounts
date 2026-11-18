---
'accounts': patch
---

A page whose saved session expired no longer loads the dialog's frame, nor the chunk of the default dialog, while an authorization in progress renews the session, such as the one of `react` at mount. The renewal is a request of the page and shows no sign-in, so a returning user's page sends 2 requests to Tempo ID instead of 102. A page that the authorization leaves signed out loads the frame then.
