---
'accounts': patch
---

Fixed `AccessToken.create`'s `verify` for a DPoP token. It verifies the request's DPoP proof, given as `dpop`, against the key that binds the token, and throws `AccessToken.InvalidError` without a valid proof. The token's `proof` holds the proof's `id`, so the API refuses a repeated proof. Before, a DPoP token verified with no proof, so an API accepted a stolen DPoP token as a Bearer token. The `viem` plugin's `verifyHash`, `verifyMessage`, and `verifyTypedData` take `dpop` too. A Bearer token sent with the `DPoP` scheme throws too, and the proof's `htm` must equal the request's method exactly. A caller that sends a DPoP `accessToken` without `dpop` now receives `AccessToken.InvalidError`.

```ts
const [scheme, accessToken] = request.headers.get('authorization')!.split(' ')
const token = await verifier.verify({
  accessToken: accessToken!,
  dpop: { method: request.method, proof: request.headers.get('dpop'), scheme, url: request.url },
})
```
