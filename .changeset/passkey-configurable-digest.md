---
'accounts': patch
---

`Actions.passkey.register` with `accessKey`, and `Actions.email.signIn` for a new user's passkey account, derive the proof's challenge on a chain whose accounts are configurable. Tempo ID's options carry `keyAuthorization` in place of `proof` there, since the access key's digest binds the configurable account that the new passkey owns. The call derives that digest from the new passkey's public key, so it sends no request between the two prompts. A Tempo ID whose options carry neither returns the proof step, as before.
