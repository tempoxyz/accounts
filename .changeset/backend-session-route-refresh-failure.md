---
'accounts': patch
---

`GET /auth/session` answers 503 with `temporarily_unavailable`, and keeps the cookie, when the refresh of the cookie's session receives no response, or a 429 or 5xx status, in place of a rejected `accounts.handler.fetch`. Another refusal, such as `invalid_dpop_proof`, ends the session, which revokes its refresh token, returns `{ session: null }`, and deletes the cookie, so the page signs in again.
