---
'accounts': patch
---

`Accounts.RequestError.Reason` mirrors Tempo ID's refusal reasons. It adds `invalid_client_metadata` and `invalid_redirect_uri`, and drops `foreign_origin` and `missing_code_challenge`, which Tempo ID no longer returns.
