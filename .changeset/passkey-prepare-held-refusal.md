---
'accounts': patch
---

The handle of `Actions.passkey.prepare` and `passkey.prepare` keeps a refusal of its options request, such as `limit_exceeds_maximum`, and its next `signIn` within 4 minutes, on the same chain, throws that refusal without another `POST /v1/auth/passkey/options`.
