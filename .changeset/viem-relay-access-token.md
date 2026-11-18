---
'accounts': patch
---

Changed the `viem` plugin's `relay` transport to send the access token of the instance's session to a route at the app's origin, through the instance's `fetch`. Before, it sent no credential, so the route could not verify its caller. A route at another origin receives it only with `relay: { credentials: 'include', url }`. A fixed `session`'s client, and a relay URL with its own credentials, receive no access token.
