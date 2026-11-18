---
'accounts': patch
---

**Breaking:** The renewal of an expired access key never continues without an access key. If `Accounts.create` names no `accessKey`, `authorize` and `session.get({ reauthorize: true })` request the expired access key's limits, scopes, and lifetime again. If Tempo ID refuses that access key, such as for a passkey that must sign it, limits above the headless ceiling, or an account of another user, the session stays empty, where it held tokens without an access key before. `authorize` throws the refusal, and `session.get` returns `undefined` with the status `signedOut`, so the page shows its sign-in. In one instance, a session whose sign-in requested an access key thus never becomes one without. A later instance, such as after a reload, holds no expired access key, so it renews none. A refusal that the access key does not cause, such as `rejected` for the app, throws from both calls. Removed `checked` from `Actions.authorize`, which only the removed second request passed.

```diff
  const session = await accounts.session.get({ reauthorize: true })
- // A refused renewal returned a session without `key`.
- if (session && !session.key) await accounts.dialog.signIn({ accessKey })
+ // A refused renewal returns no session.
+ if (!session) await accounts.dialog.signIn({ accessKey })
```

An app that wants the tokens alone after a refused renewal requests them itself. It catches only a `RequestError`, so an authorization that a sign-out overtook, which throws `SupersededError`, signs nothing in again.

```diff
- const session = await accounts.authorize()
+ const session = await accounts.authorize().catch((error: unknown) => {
+   if (!(error instanceof Accounts.RequestError)) throw error
+   return accounts.authorize({ accessKey: false })
+ })
```
