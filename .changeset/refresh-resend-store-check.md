---
'accounts': patch
---

Changed `session.refresh` outside a browser to check the store and the 10-second resend window before every later send of a refused refresh token, not only the first resend, so a resend that gets no answer never sends the token past the window or over another process's saved rotation.
