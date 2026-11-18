---
'accounts': patch
---

`email.signIn` and `Actions.email.signIn` state a recovery without a new code when a new user's passkey account registration fails, such as after a dismissed prompt. The user stays signed in without an account, so `passkey.register` with `accessKey` creates the passkey and the account, with its options request and its verify request. The call takes the sign-in's `challenge` and the `createFn` of `email`, since the `passkey` plugin does not read them.

```ts
// From a click, after `email.signIn` throws for a new user's dismissed creation prompt:
const session = await accounts.passkey.register({
  accessKey: { expiry: '1d', limits: [{ limit: '100', token: 'ousd' }] },
})
```
