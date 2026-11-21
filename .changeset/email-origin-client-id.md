---
'accounts': patch
---

Changed the `rejected` message of `email.sendCode` and `email.signIn` for an origin client ID, such as the page origin of an instance without `clientId`: it now names `clientId`. The `email()` examples now pass `clientId`.
