---
"accounts": patch
---

Added `onError` option to `Remote.respond`. Return `true` from the callback to suppress the error response to the parent, allowing the dialog to show a recovery UI instead of rejecting.
