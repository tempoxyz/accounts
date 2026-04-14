---
'accounts': patch
---

Add a shared `CliAuth.from()` helper to reuse CLI auth defaults and cached clients across create, pending, poll, and authorize flows, and reject device-code requests for unconfigured chains.
