---
'accounts': patch
---

`verifyHash`, `verifyMessage`, and `verifyTypedData` of the `viem` plugin return `false` for the zero address, before any request and without a read of `accessToken`. `verifySiweMessage` returns `false` for a message that names the zero address, and verifies on a client without the account, so it throws no `SignedOutError`. The chain's `ecrecover` returns the zero address for a signature that recovers no key, so each returned `true` for such a signature before.
