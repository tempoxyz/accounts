---
'accounts': patch
---

Fixed a sign-in refused after Tempo ID signed the user in, such as an expired code in a redirect's callback, leaving the refresh token of the session that it emptied live. The refusal now revokes that refresh token beside the rejection.
