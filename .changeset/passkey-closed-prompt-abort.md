---
'accounts': patch
---

`passkey.signIn`, the `signIn` of a `passkey.prepare` handle, and `passkey.register` throw an `Error` named `AbortError` when the user closes the passkey prompt or lets it time out, as `dialog.signIn` does for a closed dialog. They threw ox's `Authentication.SignFailedError` or `Registration.CreateFailedError`, which an app could not tell apart from a failure. The `AbortError` holds ox's error as its `cause`.

```ts
try {
  await accounts.passkey.signIn()
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') return
  throw error
}
```
