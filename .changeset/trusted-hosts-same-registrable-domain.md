---
"accounts": patch
---

Replaced the `.local` shortcut in `TrustedHosts.match` with an opt-in `source` parameter that treats hostnames sharing the same registrable domain ("eTLD+1") as `source` as trusted.
