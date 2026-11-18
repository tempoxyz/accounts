---
'accounts': patch
---

Fixed the DPoP proofs of a `dpop` key whose `jwk` also holds the private key, such as the export of an extractable private key. Each proof's header now carries only the JWK's public members, `crv`, `kty`, `x`, and `y`, so the private scalar `d` no longer reaches Tempo ID or an app's API.

```ts
import { Accounts } from 'accounts'
import { Dpop } from 'accounts/internal'

const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
  'sign',
  'verify',
])
const jwk = (await crypto.subtle.exportKey('jwk', pair.privateKey)) as Dpop.Dpop.Jwk

const accounts = Accounts.create({
  clientId: 'my-app',
  // Each proof carries { crv, kty, x, y } only.
  dpop: { jwk, privateKey: pair.privateKey },
})
```
