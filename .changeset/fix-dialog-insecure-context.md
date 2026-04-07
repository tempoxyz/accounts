---
'accounts': patch
---

Fixed `Dialog.isInsecureContext()` to return `true` for `http:` protocol — `http://localhost` is a secure context but WebAuthn still requires HTTPS, so the dialog now correctly defaults to popup.
