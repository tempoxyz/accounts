---
'accounts': patch
---

Changed the `viem` plugin to load the access token verifier of `verifyHash`, `verifyMessage`, and `verifyTypedData` at the first verification with `accessToken`. Before, every app of the `viem` or `wagmi` plugin bundled the verifier and jose, about 8 KB gzip, at load.
