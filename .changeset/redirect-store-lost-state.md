---
'accounts': patch
---

Fixed `Actions.redirect.complete` and the restore of `redirect` without `open` for a custom `store` that holds no state of the redirect, such as `Store.memory` after the page load. The callback's `session.get()` resolved with `undefined` and removed the `code`, so the user's sign-in on Tempo ID's pages ended in no session and no error. With a custom `store`, `Actions.redirect.start` now keeps the redirect's `state` in the tab's `sessionStorage`, and the return of that redirect rejects with `Accounts.RequestError`, with `invalid_request` and the `field` `state`. It redeems no code, and the session stays as it was. A callback that the tab did not start, such as a crafted link, still resolves with `undefined`.

```ts
try {
  await accounts.session.get()
} catch (error) {
  if (error instanceof Accounts.RequestError && error.field === 'state') {
    // The store lost the redirect's state at the page load, and a restart loses it again.
    // Keep the state in a store that persists across page loads, such as the default.
  }
}
```
