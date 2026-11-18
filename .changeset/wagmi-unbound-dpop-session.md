---
'accounts': patch
---

Changed the `tempoId` connector of `accounts/wagmi` to sign in again, outside a browser, over a saved session that another DPoP key binds, such as the DPoP key of an earlier run whose `dpop` plugin got no `store`. Every request refuses such a session, and before, wagmi's `reconnect` connected to it and `connect` returned it, so the app could neither use it nor sign in. Outside a browser, `isAuthorized` now returns `false` for it, so `reconnect` skips it, and `connect` signs in again.

```ts
await reconnect(config) // skips the session that another DPoP key binds
await connect(config, { connector }) // signs in again
```
