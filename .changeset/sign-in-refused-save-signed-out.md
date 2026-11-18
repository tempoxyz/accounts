---
'accounts': patch
---

Fixed a sign-in whose save the store refuses, such as `Store.redis` in a browser, whose access key has no JSON form. The sign-in rejected with the store's error, but the instance still held the session as `signedIn` until the next load, and no context revoked its refresh token. The instance now holds no session, and revokes the refresh token beside the rejection.

```ts
await accounts.dialog.signIn().catch(() => undefined) // TypeError: Unserializable value
accounts.session.status.get().status // 'signedOut'
```
