---
'accounts': patch
---

Fixed concurrent transactions of an access key in one instance, such as the requests of a server for one session. A transaction that starts while another transaction of the same account is in flight now takes an expiring nonce, so each one lands. Before, both filled the same protocol nonce, and every transaction but one threw a nonce error.

```ts
// Three requests of one session at once now send three transfers.
await Promise.all(
  requests.map(() =>
    accounts.viem({ session }).token.transferSync({ amount, to, token }),
  ),
)
```
