---
"accounts": minor
---

Add `Dialog`'s `onCancel(keep?)` callback to cancel the queue at the moment a person leaves an approval, while retaining an already executing request. Requests queued afterwards are not cancelled when that execution finishes. Replaced or reset dialogs cannot cancel a new dialog's queue.

The new required `Dialog.SetupFn.Parameters.onCancel` parameter is supplied by the SDK. Code that constructs setup parameters directly must supply it. This enables custom dialogs, including the wallet's in-page approvals; built-in iframe/popup cancellation is unchanged. Keeping an executing queue head does not resend it to the dialog.
