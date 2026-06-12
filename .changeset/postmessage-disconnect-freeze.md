---
"accounts": patch
---

Fixed the `postMessage`/`tempoWallet` adapter freezing on the next login after a disconnect. `wallet_disconnect` no longer tears down the wallet-page session — the session and its iframe mount are a persistent channel that stays warm across disconnect, so the next login reuses the already-handshaked session instead of stranding on a stale handshake.
