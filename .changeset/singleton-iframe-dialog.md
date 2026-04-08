---
'accounts': patch
---

Fixed `Dialog.iframe()` injecting duplicate iframes by caching the instance as a singleton keyed by host.
