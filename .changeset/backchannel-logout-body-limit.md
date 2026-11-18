---
'accounts': patch
---

Changed `POST /auth/backchannel-logout` of `accounts.handler` to answer a body above 64 KiB with 413 `invalid_request`, and to stop reading it at the chunk that crosses 64 KiB. Any server can post to the route, which buffered each body whole before.
