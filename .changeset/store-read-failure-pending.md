---
'accounts': patch
---

**Breaking:** `session.get` rejects with the store's error when the read of the saved session fails before any change sets a session, and the status stays `pending`. Before, it returned `undefined`, and the status became `signedOut`, so `useSession` showed the sign-in to a returning user, such as while a device's secure store is locked. A saved record that holds no valid session, or a stored entry without valid JSON, still returns `undefined`.

```diff
- const session = await accounts.session.get()
+ const session = await accounts.session.get().catch((error) => {
+   // The store failed. The status stays `pending`, and the next call reads again.
+   showRetry(error)
+   return undefined
+ })
```
