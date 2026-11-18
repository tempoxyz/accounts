---
'accounts': patch
---

Added `session` to `accounts.pay`. With the `viem` plugin, the access key of that session sends the payment, such as the session of a backend's request, whose instance holds no session of its own. The access key on the payment's chain names the account, so the call reads neither the store nor Tempo ID. A session without an access key on the payment's chain throws `Accounts.AccessKeyRequiredError`.

```ts
app.post('/v1/pay', async (c) => {
  const session = await accounts.session.get(c.req.raw)
  if (session?.method !== 'tempo-id') return c.json({ error: 'invalid_token' }, 401)

  const { transaction } = await accounts.pay({
    amount: '1',
    session,
    to: '0x000000000000000000000000000000000000dEaD',
    token: 'ousd',
  })
  return c.json({ transaction })
})
```
