---
'accounts': patch
---

Changed `Actions.redirect.complete`, and `session.get()` on a redirect's callback page, to remove the redirect's stored state beside the code exchange. Before, a store of the instance's own, or a tab without its copy of the verifier, removed the state first, then started the exchange.
