---
'accounts': patch
---

Fixed `relay` relaying on the instance's chain at its creation after `switchChain`. The route now reads the instance's chain at each request, unless the plugin names `chainId`.

The Viem relay mode also relays on every chain of the `viem` plugin, including one that only its options define.
