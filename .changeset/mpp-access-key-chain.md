---
'accounts': patch
---

Fixed the `mpp` payer for a 402 response with charge offers on several chains. It paid the endpoint's first offer, also on a chain that the access key does not authorize, which failed. It now skips each offer on another chain, and pays the first offer on the access key's chain. A response without one rejects before the access key signs.

```ts
const accounts = Accounts.create({ plugins: [backend({ store }), viem(), mpp()] })

const response = await accounts.mpp({ session }).fetch(url)
```
