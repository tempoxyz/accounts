---
"accounts": patch
---

Added `handoff` to the postMessage `tempoWallet()` adapter and `Handoff.read()`. Tempo Wallet shows a QR code so someone without a passkey on the computer can approve the request with their phone. By default the requesting tab receives the result. With `handoff.url`, the phone's browser opens that page on the app's origin instead, and it receives the result and an access key the phone generated, which `Handoff.read()` returns. `handoff: false` hides the QR code.
