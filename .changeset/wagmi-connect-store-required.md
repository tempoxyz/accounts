---
'accounts': patch
---

Fixed the `tempoId` connector's `connect` outside a browser without `store`. It throws `wagmi.StoreRequiredError` before the sign-in, and sends no request. Before, the sign-in ran, the instance dropped its tokens without a revocation, and `connect` threw `wagmi.SignInIncompleteError`.
