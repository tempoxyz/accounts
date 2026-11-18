---
'accounts': patch
---

Fixed `backend` sessions that never expired in their store. Each session now passes one day after its access key's expiry to `setItem` as `expiresAt`, so a `get` within that day still revokes the refresh token, and a store that expires entries, such as a Durable Object's or Redis, deletes an abandoned session with its access key and refresh token. Before, the session stayed until a later `get` or `end`.

```ts
const accounts = Accounts.create({
  accessKey: () => ({ expiry: '1d', limits: [{ limit: '100', token: 'ousd' }] }),
  plugins: [backend({ store: Store.redis(redis) })],
})
```
