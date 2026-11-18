---
'accounts': patch
---

Changed `backend.get` and `backend.fetch` to throw `invalid_dpop_proof` without a refresh, and keep the session, when a refresh is due and another DPoP key, or no key, binds the session's tokens. Before, each read sent a refresh that Tempo ID refused, and a refresh without an answer ended the session.
