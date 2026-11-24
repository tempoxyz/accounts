---
'accounts': patch
---

Fixed `siwe.approve` to read the nonce and origin of the submitted message from its lines, and to parse only the challenge's own message. Raised the `viem` peer range to `^2.58.6`.
