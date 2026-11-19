---
'accounts': patch
---

Fixed `local.remove` to sign out its own instance when instances share one `local()` plugin, and ordered local sessions by their new `revision`, so an access key that another instance added with a sooner expiry stays.
