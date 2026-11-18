---
'accounts': patch
---

Changed `session.accessToken` and `session.fetch` to throw `Accounts.SignedOutError`, and send no request, for a session without a refresh token whose access token expires within 5 seconds. Before, they returned or sent that access token, which can expire before the request arrives.
