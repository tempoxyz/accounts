---
'accounts': patch
---

Added `options.redirectUri` to the `open` option of `redirect`: the redirect URI of the sign-in URL. The `expo` preset closes the authentication sheet at it, so a `redirectUri` of `Accounts.create` that overrides the preset's returns the callback to the app.

```ts
redirect({
  open: (url, options) => openAuthSession(url, options.redirectUri),
})
```
