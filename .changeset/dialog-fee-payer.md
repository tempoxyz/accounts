---
'accounts': patch
---

Added fee payer support for the dialog adapter. When `feePayerUrl` is configured, transactions sent through the dialog embed now use `withFeePayer` transports for preparation and sending.
