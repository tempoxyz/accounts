---
'accounts': minor
---

Moved `AccessKey`, `AccessToken`, `Actions`, `ClientAssertion`, `Dpop`, `LogoutToken`, `TempoAccount`, and `Tokens` from `accounts` to `accounts/internal`, beside `Authorization`, `Funding`, `Pending`, and `User`. The root entry exports only `Accounts`, `Permissions`, `Plugin`, `Session`, and `Store`.
