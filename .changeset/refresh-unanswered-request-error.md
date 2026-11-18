---
'accounts': patch
---

Fixed `accounts.session.refresh` and `Actions.refresh` when no attempt receives a response, such as offline. They throw `Accounts.RequestError` with `server_error` and status 0, in place of the platform's `TypeError`.

```ts
await accounts.session.refresh().catch((error) => {
  if (error instanceof Accounts.RequestError && error.status === 0) return showOffline()
  throw error
})
```
