---
'accounts': patch
---

Signs a `challenge` with the proof of a passkey registration with an access key, in `passkey.register` and in a new user's `email.signIn`. The access key's witness is the challenge's EIP-191 hash, so the new passkey creates the account, signs the access key and signs the challenge in two prompts, and `challengeSignature` is the key authorization's signature, as for a sign-in. Before, the proof bound Tempo ID's own witness, and a third prompt signed the challenge. Against a Tempo ID that still binds its own witness, the call signs the challenge in a third prompt as before.
