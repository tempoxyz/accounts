---
'accounts': patch
---

Removed `missing_recipients` from `RequestError.Reason`, since Tempo ID accepts a scope of any call on a TIP-20 token and an `approve` without `recipients`. Each sign-in now throws `duplicate_scope` before the request for a scope of any call beside another scope on its TIP-20 token.
