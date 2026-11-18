---
'accounts': patch
---

Fixed `POST /auth/callback` of the `backend` plugin, which completes `dialog.signIn({ backend })`. A refused callback answers with the refusal's OAuth error body, with `error_description`, `field`, and `reason`, and with Tempo ID's status, or 503 for a code exchange without a response. Before, every refusal answered 400 with `error` only, so the page's `Accounts.RequestError` had no `reason`, and its message was the code.

```ts
await accounts.dialog.signIn({ backend: true }).catch((error) => {
  if (error instanceof Accounts.RequestError && error.status === 503) return showOffline()
  throw error
})
```
