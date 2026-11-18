---
'accounts': patch
---

Fixed the refusal of an ID token whose claims do not parse. Each sign-in throws `Accounts.RequestError` with `server_error` and status 200, and the error quotes none of the token. Before, a sign-in threw the parser's error, which quoted the token's claims, or reported it with status 0 as a request without a response.
