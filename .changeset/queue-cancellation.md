---
"accounts": patch
---

Add `Dialog`'s `onCancel(keep?)` callback to cancel the queue at the moment a person leaves an approval, while retaining an already executing request. Requests queued afterwards are not cancelled when that execution finishes. Replaced or reset dialogs cannot cancel a new dialog's queue.
