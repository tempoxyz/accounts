---
'accounts': patch
---

Raised the `viem` peer range to `^2.57.17`. With it, a webpack build without `mppx` builds, a read with an access key that the chain has not registered succeeds, and `withRelay` sends each failed request once.
