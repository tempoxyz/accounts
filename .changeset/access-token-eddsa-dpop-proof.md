---
'accounts': patch
---

Fixed `AccessToken.create`'s `verify` for a DPoP token whose proof signs with EdDSA, such as from an Ed25519 key. Tempo ID accepts EdDSA proofs and binds tokens to their keys, but `verify` accepted only ES256 proofs, so it threw `AccessToken.InvalidError` for each request with such a token. It now accepts ES256 and EdDSA, as Tempo ID does.
