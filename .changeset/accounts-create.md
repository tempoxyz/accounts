---
'accounts': minor
---

Renamed the `Id` module to `Accounts`: `Id.create`, `Id.from`, the `Id` instance type, and the error classes, such as `Id.RequestError`, are now `Accounts.create`, `Accounts.from`, `Accounts.Accounts`, and `Accounts.RequestError`. Each error's `name` changes the same way, such as `Accounts.RequestError`.
