---
"accounts": patch
---

`Handler.relay` no longer signs as its own fee payer when a request names an app's fee payer URL and that relay returns an unsigned fill. It answers with an invalid-params error instead, so an app's URL can no longer make the relay's fee payer pay without its `validate`.
