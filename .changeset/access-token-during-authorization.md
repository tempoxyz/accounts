---
'accounts': patch
---

Fixed `session.accessToken` and `session.fetch` during an authorization. A call without a session, such as while `session.status` is `reauthorizing` for an expired access key, waits for the authorization, as `session.get` does, and uses its access token. Before, it threw `Accounts.SignedOutError`, and the authorization then signed the user in. A call from a function `reauthorize` or a plugin's `restore` hook waits for no authorization, since that authorization waits for it, and a renewal that signs in another user throws `Accounts.SignedOutError`.
