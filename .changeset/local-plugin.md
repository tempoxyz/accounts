---
'accounts': minor
---

Added the `local` plugin of `accounts/plugins`, which holds a Tempo Account's secp256k1 owner key in the instance's store and signs in without Tempo ID: each sign-in authorizes an access key that the owner signs, and `v0` takes the account of an accounts v0 `Storage.filesystem` file. Its session is a `Session.LocalSession`, with `kind: 'local'` and no tokens. An instance with the plugin holds `Session.Any`; one without it holds `Session.Session` as before. Added `Session.local`, `Session.subject`, `Session.same`, and `Accounts.LocalSessionError`, which the calls that read Tempo ID throw for a local session.
