---
'accounts': patch
---

The `tempoId` connector of `accounts/wagmi` sends no `GET /v1/account` for a third-party client ID, such as an origin. Tempo ID returns the Tempo Account only to a first-party app, and the page of a third-party app has no CORS grant for the read. For a session without an access key, `connect` now throws `wagmi.AccountUnavailableError` with no request, in place of `TypeError: Failed to fetch`. wagmi's `reconnect` sends no request at each load, and stays disconnected. `accounts.switchChain`, and the connector's `switchChain`, also send no read for such a client ID, so the switch selects the chain in place of a rejection with the fetch error.

```ts
tempoId({ accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] } })
```
