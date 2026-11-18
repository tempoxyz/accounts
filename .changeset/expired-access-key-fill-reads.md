---
'accounts': patch
---

Removed the node requests that follow a refused fill of an expired access key. The `viem` plugin refuses the fill of an expired access key before the request. Viem then read the nonce, the block, and the priority fee, and refused its own estimate. The refusal now ends the preparation. On a page, the node receives only the fill and the send of the renewed access key. Outside a page, such as a backend with a fixed session, the node receives no request.
