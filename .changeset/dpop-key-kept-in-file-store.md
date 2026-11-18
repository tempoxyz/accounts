---
'accounts': patch
---

The `dpop` plugin keeps its DPoP key across runs outside a browser in `Store.file`, which only its user reads. The file keeps the private key as a JWK, beside the session's refresh token, and each later call imports it as non-extractable. `Store.file` sets the new `private` property of `Store`, and a shared store, such as `Store.postgres`, keeps no private key. A CLI with `dpop({ store: Store.file() })` thus refreshes and sends its DPoP tokens at its next run, where each request threw `invalid_dpop_proof` before.

```ts
const accounts = Accounts.create({
  clientId: 'cli:acme-deploy',
  plugins: [device({ onCode }), await dpop({ store: Store.file() })],
})
```
