---
'accounts': patch
---

Fixed `Actions.redirect.complete`, and `session.get()` on a redirect's callback page, dropping the tokens of a code that the tab redeemed when the store holds no state of the redirect, such as after another tab completed it. It now revokes the refresh token of the code, and throws `Accounts.RequestError` with `invalid_request`, status 400, and `signedIn`. Before, it returned `undefined`, as for a page load without a callback, and the refresh token stayed live. The refusal ends the instance's session, as each refusal after a sign-in does, so the session that the other tab set ends too. A refused exchange of such a code, such as one of a code that another tab redeemed, issued no tokens, so `complete` still returns `undefined`, and the session of the other tab stays.

```ts
// On the callback's page of a redirect that another tab completed, the read throws.
const session = await accounts.session.get().catch((error: unknown) => {
  if (error instanceof Accounts.RequestError && error.signedIn) return undefined
  throw error
})
if (!session) button.onclick = () => accounts.redirect.signIn()
```
