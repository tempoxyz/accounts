---
"accounts": patch
---

A remote wallet now refuses `wallet_connect` with `capabilities.digest`. The wallet signed that raw hash behind a sign-in prompt, so an app could pass a transaction hash and have it signed without the user seeing it. `Remote.validateSearch` rejects it (`-32602`), and `remote.respond` refuses to execute such a request. Adapters running in the app itself still honor `digest`. Use `capabilities.personalSign` to sign during connect.
