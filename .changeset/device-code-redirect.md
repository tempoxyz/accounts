---
'accounts': patch
---

Fixed `Actions.device.authorize`, `device.signIn`, and `device.authorize` for a `url` that answers the code request with a redirect. The call throws `Accounts.RequestError` with `redirect_refused` and status 0 before `onCode`, and posts nothing to the other origin. Before, the code request followed the redirect, `onCode` showed a code, and each poll then failed with `redirect_refused` after the user approved the code. React Native's `fetch` ignores `redirect` and follows the redirect.

```ts
await accounts.device.signIn() // rejects with `redirect_refused`, before `onCode`
```
