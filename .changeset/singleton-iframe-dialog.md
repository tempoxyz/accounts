---
"accounts": patch
---

Fixed `Dialog.iframe()` injecting duplicate iframes when `tempoWallet()` was instantiated multiple times (React StrictMode, HMR, multiple configs). The iframe instance is now cached as a singleton keyed by host URL — subsequent setup calls swap the store and fallback refs and return the cached instance.
