---
'accounts': minor
---

Added `scope` to `device.signIn` and `Actions.device.authorize`, which requests a registered API's own scopes beside `resource`; the tokens carry those the user keeps on the device page. Added `invalid_scope` to `Accounts.RequestError.Reason`.
