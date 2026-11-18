---
'accounts': patch
---

Fixed `dialog.signIn` with the backend plugin throwing the `TypeError` of `fetch` when the backend's `/login`, `/callback`, or SIWE route does not answer, such as offline. It throws `Accounts.RequestError` with the code `server_error` and status 0, as a sign-in without a backend does, and with `signedIn` once the user signed in on Tempo ID.

```ts
try {
  await accounts.dialog.signIn()
} catch (error) {
  if (error instanceof Accounts.RequestError && error.status === 0) {
    // The backend did not answer. Check the connection, then sign in again.
  }
}
```
