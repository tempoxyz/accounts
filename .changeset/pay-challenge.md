---
'accounts': patch
---

Added `challenge` to `accounts.pay` and `Actions.account.pay`, and made `account` optional in `Actions.account.pay`. With `challenge`, a Sign-In with Ethereum message from `siwe.start`, the payment page signs the user in if needed, pays from the account selected for the app or the user's oldest, and Pay has the account sign the message before the transfer. The call resolves with `address` and `challengeSignature` beside `transaction`, which `siwe.complete` verifies. No plugin sends such a payment with the session's access key. Each payment now resolves with `address`, the account that paid.

```ts
const { address, challengeSignature, transaction } = await accounts.pay({
  amount: '1',
  challenge: message,
  to: '0x1f9090aaE28b8a3dCeaDf281B0F12828e676c326',
  token: 'ousd',
})
```
