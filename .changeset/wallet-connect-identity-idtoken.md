---
"accounts": patch
---

Added OIDC identity-token support for verified emails — `Handler.oidcProvider` mints signed id tokens during `wallet_connect`, `Handler.auth({ identity })` verifies them and folds the email onto the session, and `Identity.verify` provides standalone verification.
