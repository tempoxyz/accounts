---
'accounts': patch
---

Added `signal` to `device.signIn`. Once it aborts, the sign-in sends no further poll and rejects with the signal's reason, as `device.request` does. If a poll in flight returns an approval, the sign-in still signs the user in. Before, `device.signIn` ignored it and polled until the code expired.

```ts
const { user } = await accounts.device.signIn({
  signal: AbortSignal.timeout(120_000),
})
```
