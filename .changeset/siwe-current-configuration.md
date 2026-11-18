---
'accounts': patch
---

Fixed the `siwe` plugin's verification, which accepted two signatures that are not the account's. `complete` and `approve` now refuse both with the reason `signer`.

- The retired root key of an account that was upgraded in place (TIP-1113). Its signature still recovers the account's address. Viem 2.57.19 reads the account's config commitment on the message's chain for such a signature, and refuses it for an account that holds one. An ERC-6492 or ERC-8010 wrapper hides the root key's signature from that read, so the plugin reads the config commitment beside Viem's verification for a wrapped signature that is not a configurable account's. A configurable account's signature verifies with the chain's signature verifier, as before, and now without its wrapper, whose call the signer chooses.
- An access key's signature: a keychain envelope, or a pre-authorized signature (TIP-1165), also inside an ERC-6492 or ERC-8010 wrapper. Before, the account's code on the chain alone decided it. The refusal now sends no request. A wrapper that does not parse, a signature in more than two wrappers, and a signature that is no hex string, such as the bytes of an envelope, are refused in the same way.

An owner key's sign-in or approval thus sends one `eth_call`, where it sent none. If the chain does not answer, `complete` and `approve` reject with the transport's error.
