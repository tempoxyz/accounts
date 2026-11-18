---
'accounts': patch
---

Fixed concurrent charges of `accounts.fetch` and `accounts.mpp({ … }).fetch` from two instances on one `store`, such as two processes of a server, for an access key that the chain does not hold yet. Both charges attached the key authorization, the chain registered it once, and the endpoint answered the other charge with a 500. If the endpoint refuses a charge that attached the key authorization, and that awaits no fee payer, the payer now reads the access key's metadata and the transaction's receipt. If the chain holds the access key and the transaction did not land, the payer records the registration, and sends the request once more without the key authorization.

```ts
// Two instances on one store: each request pays once.
await Promise.all([first.fetch(url), second.fetch(url)]) // [200, 200], before [200, 500]
```
