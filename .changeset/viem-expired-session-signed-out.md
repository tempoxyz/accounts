---
'accounts': patch
---

Changed the `viem` plugin's clients outside a page, such as in React Native or Node, to reject a transaction of an expired access key with `Accounts.SignedOutError`, or `Accounts.KeyRequiredError` while an access key on another chain keeps the session. Before, the transaction rejected with Viem's `ContractFunctionExecutionError`, whose message was "An unknown error occurred", with the instance's error only among its causes. Reads, signatures, and `accessKey` changes that Tempo ID sends are unchanged.

```ts
const error = await accounts.token.transferSync({ amount, to, token }).catch((error) => error)
if (error instanceof Accounts.SignedOutError) await accounts.redirect.signIn()
```
