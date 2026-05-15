---
'accounts': patch
---

Made `keyAuthorization.address` optional in the RPC schema. RPC nodes return prepared transactions with only `keyId` (the access key address), so requiring `address` rejected valid `eth_signTransaction` payloads when MPP signed via an access key.
