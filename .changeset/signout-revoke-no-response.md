---
'accounts': patch
---

Fixed `signOut`, wagmi's `disconnect` through the `tempoId` connector, and `backend.end` when the revocation of the refresh token, or the logout of `signOut({ everywhere: true })`, receives no response, such as offline. They throw `Accounts.RequestError` with `server_error` and status 0, in place of the platform's `TypeError`.

```ts
await accounts.signOut().catch((error) => {
  if (error instanceof Accounts.RequestError && error.status === 0) return
  throw error
})
```
