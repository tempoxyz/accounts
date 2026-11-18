---
'accounts': patch
---

Fixed `relay` reading a request body of any size, before `authorize` and before the limit of Viem's relay. The route now reads at most 1 MiB of a body, and returns 413 with the reason `body_too_large` for a larger one, before `authorize`. A route that verifies returns the same 413 for a body whose JSON object it encodes to more than 1 MiB. Only the Viem relay mode with `verify: false` keeps the 16 MiB limit of Viem's relay.
