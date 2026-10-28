---
"accounts": patch
---

Added `handoff` to the postMessage `tempoWallet()` adapter. Tempo Wallet shows a QR code so someone without a passkey on the computer can approve the request with their phone; the requesting tab receives the result either way. `handoff.url` sends the phone's browser to a page on the app's origin afterwards, and `handoff: false` hides the QR code.
