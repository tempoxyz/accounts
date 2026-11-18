---
'accounts': patch
---

`passkey.signIn` and `passkey.prepare` default `select` to `true` after a `signOut` without `everywhere` and before the next sign-in, unless `credentialId` names passkeys. Such a sign-out keeps the browser's Tempo ID session, for whose user alone Tempo ID offered passkeys, so another user of the page could not pick a passkey.

```ts
await accounts.signOut()

// The browser offers every passkey of the relying party.
await accounts.passkey.signIn()
```

`Actions.passkey.prepare` and `Actions.passkey.signIn` also take `select` as a promise, which only the options request awaits, beside the realms read and the access key.
