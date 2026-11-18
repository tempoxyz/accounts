---
'accounts': patch
---

Added `loginHint` and `prompt` to the `backend` plugin's `backend.start`. `loginHint` fills the email field of Tempo ID's sign-in page, such as with the address of an invitation. `prompt: 'login'` requests a new sign-in of a user whom the browser holds signed in, such as to sign in to another account. A pushed request holds both.

```ts
const { id, url } = await accounts.backend.start({
  loginHint: 'user@example.com',
  prompt: 'login',
  redirectUri: 'https://app.example.com/callback',
})
```
