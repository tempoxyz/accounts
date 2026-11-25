---
'accounts': patch
---

Added the `privy_identity_rejected`, `signature_request_expired`, `signature_request_rejected`, `wallet_link_expired`, `wallet_linked`, `wallet_signature_rejected`, and `wallet_signature_required` reasons to `RequestError.Reason`, and removed `owner_app_taken`, which Tempo ID no longer returns.
