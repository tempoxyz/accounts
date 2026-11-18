---
'accounts': patch
---

Each sign-in throws `Accounts.RequestError` with `duplicate_scope` for two `accessKey.scopes` of one call on a target, and with `invalid_recipients` for the zero address or a repeated address in a limit's `spenders` or a scope's `recipients`, both with status 0, before the request that carries the access key. A dialog, popup, or redirect sign-in thus opens no window, and its error holds the `reason` that a callback from Tempo ID omits.
