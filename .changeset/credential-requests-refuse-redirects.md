---
'accounts': patch
---

Fixed the requests to Tempo ID that carry a credential, which followed a redirect to another origin. The token endpoint, `/oauth2/revoke`, `/oauth2/par`, `/oauth2/introspect`, the backend's code request, and each JSON request now set `redirect: 'manual'`. A redirect in place of a response throws `Accounts.RequestError` with the code `redirect_refused` and status 0. A sign-out keeps the refresh token for a later revocation, and a device poll or a refresh stops at once. In browsers, Node, and Workers, no code, refresh token, or client authentication reaches the redirect's origin. React Native's `fetch` ignores `redirect` and follows the redirect.
