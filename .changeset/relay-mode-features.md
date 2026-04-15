---
'accounts': minor
---

**Breaking**: Added `features` option to `Handler.relay` to control feature enablement.

- `features: 'all'` enables fee token resolution, auto-swap, and simulation (balance diffs + fee breakdown), at the cost of network latency.
- If `features` is not present, only enables fee payer sponsorship by default.
