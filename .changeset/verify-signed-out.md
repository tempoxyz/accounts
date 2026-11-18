---
'accounts': patch
---

Fixed `verifyHash`, `verifyMessage`, and `verifyTypedData` of the Viem plugin's client on an instance without a session, such as a backend's verifier. They threw `SignedOutError`, since Viem read the signed-out account as the `from` of each call. They now verify through a client without the account.

```ts
await accounts.verifyMessage({ accessToken, address, message, signature }) // no session needed
```
