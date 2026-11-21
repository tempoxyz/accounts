---
'accounts': patch
---

Fixed the `connect` of the `tempoId` connector of `accounts/wagmi` outside a page, such as in Node with `store`, without `signIn` and with the default `dialog`: it throws `wagmi.SignInRequiredError` before the sign-in, in place of a `ReferenceError` of `window`.
