---
'accounts': patch
---

Fixed a pending `dialog.signIn` that stayed open after a sign-out. A sign-out here or in another tab now rejects the sign-in, once the sign-out completes, with `Accounts.SupersededError`, and closes its dialog or its popup. A popup that the page's `Cross-Origin-Opener-Policy` severed stays open, but the instance redeems no approval from it. Before, the dialog kept Tempo ID's approval page, and the user's approval issued tokens and an access key that the instance then revoked or discarded. A sign-out after the approval keeps the issued tokens until the commit, which revokes them.

`Actions.dialog.signIn` takes `cancel`, a signal that ends the call only until the callback arrives. After it, the call resolves with the issued tokens, so the caller revokes them.

```ts
await accounts.dialog.signIn().catch((error) => {
  if (!(error instanceof Accounts.SupersededError)) throw error
})
```
