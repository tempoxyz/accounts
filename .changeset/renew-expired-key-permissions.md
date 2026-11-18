---
'accounts': patch
---

Fixed `session.get({ reauthorize: true })` and `authorize` for a session whose access key came from the sign-in's own `accessKey`. If `Accounts.create` names no `accessKey`, the renewal requests the expired access key's limits, scopes, and lifetime again, so the renewed session keeps an access key that lives no longer than the first. If Tempo ID refuses that access key, such as for a passkey that must sign it or limits above the headless ceiling, the session stays empty. Added `lifetime` to `AccessKey.AccessKey`, `context.session.renewing` to plugins, and `AccessKey.permissions` to `accounts/internal`.

```ts
await accounts.email.signIn({ accessKey: { expiry: '1d', limits }, code, email })
// After the access key expires:
const session = await accounts.session.get({ reauthorize: true })
session?.key // A new access key with the same limits and scopes, for one day
```
