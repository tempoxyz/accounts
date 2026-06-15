---
"accounts": patch
---

Include the signing key type in `eth_fillTransaction` so the node estimates intrinsic gas for the correct signature size. Root accounts signing with p256/webAuthn were filled as secp256k1 (the smallest signature), underestimating gas. The root fill path now resolves the signer's key type (a caller's explicit `keyType` wins, otherwise the stored root account's) and hands viem's tempo formatter an account carrying it, which forwards `keyType` and derives the webAuthn `keyData` size hint. secp256k1 (the node default) is unaffected. The managed access-key path already carried its key type via the viem account and still attaches a pending `keyAuthorization` when present so the estimate prices its on-chain authorization.
