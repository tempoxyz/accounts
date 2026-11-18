---
'accounts': patch
---

`email.signIn` throws `Accounts.RequestError` with `invalid_field`, the field `code`, and status 0 for a code that holds other than 6 digits, on a page and on a backend, before any request. A sign-in with `link` thus prompts for no passkey before a mistyped code fails, and the error holds the `reason` that a network error lacks.
