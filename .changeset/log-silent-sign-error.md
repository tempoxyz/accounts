---
"accounts": patch
---

Log the underlying error when silent signing with an access key fails in the `dialog` adapter. The `withAccessKey` catch block now logs the thrown error via `console.warn` before removing the stale key, so consumers get a signal for why a silent sign fell back to the approval dialog.
