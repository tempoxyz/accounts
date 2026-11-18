---
'accounts': patch
---

Fixed the sign-ins that push their request to `/oauth2/par`, such as `redirect.signIn` with `par`, when the push receives no response, such as offline. They throw `Accounts.RequestError` with `server_error` and status 0, in place of the platform's `TypeError`.

```ts
await accounts.redirect.signIn().catch((error) => {
  if (error instanceof Accounts.RequestError && error.status === 0) return showOffline()
  throw error
})
```
