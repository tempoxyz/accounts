# MPP payments

## Overview

An endpoint of the Machine Payments Protocol (MPP) responds with a 402 challenge, and serves its content for a credential that pays it. A charge pays once, with a transfer. A session pays each request with a voucher from a channel that holds a deposit. The [`mpp`](../api/mpp.mpp.md) plugin pays both with the app's [access key](access-keys.md), through [mppx](https://github.com/wevm/mppx), which the app installs beside `accounts`.

```ts
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { dialog } from 'accounts/plugins'

const accounts = Accounts.create({
  // 1. The access key may spend 10 OUSD for a day, in charges and sessions.
  accessKey: { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
  // 2. The plugin pays with the access key of the instance's session.
  plugins: [dialog(), mpp({ maxAmount: '1' })],
})

await accounts.dialog.signIn()

// 3. A 402 response starts the payment, and the retry returns the content.
const response = await accounts.fetch('https://api.example.com/fortune')
```

1. Without `scopes`, the access key may call `transfer` and `transferWithMemo` on OUSD, and `open` and `topUp` on the TIP-1034 channel reserve. A charge calls `transferWithMemo`, since mppx binds each transfer to its challenge with a memo. A session calls `open` and `topUp`, which the [recognized calls](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#recognized-calls) include. The token limit caps each deposit.
2. The access key signs every transaction, proof, and voucher. The first payment attaches the key authorization, which registers the access key on chain. `maxAmount` refuses a charge above 1 OUSD before the access key signs.
3. `accounts.fetch` is `fetch` with the payment of each 402 charge challenge. The app's other requests stay unchanged. In the default `'pull'` mode, the endpoint broadcasts the charge's transaction. `mode: 'push'` makes the app broadcast it.

## Recipes

### Pay with a session

A session opens a channel with a deposit, and then pays each request with a voucher. The channel names the access key as its signer, so no voucher reaches the account's owner.

```ts
const session = accounts.mpp.session({ maxDeposit: '0.05' })

try {
  await session.fetch('https://api.example.com/content') // opens the channel
  await session.fetch('https://api.example.com/content') // pays with a voucher
} finally {
  await session.close()
}
```

A request above the deposit tops up the channel. Without the `topUp` scope, the top-up fails with `CallNotAllowed`. The manager holds the channel in memory, so close it also when a request fails. Otherwise the deposit stays in the channel.

### Prove the account without a payment

A charge of `0` asks for a signed proof of the account, and moves no tokens. The access key signs the proof, and the endpoint verifies it against the chain's keychain. The chain holds the access key only after its first transaction, so until then the endpoint refuses the proof with a 402.

### Pay from a backend

A backend pays with the access key of a session that its [`backend`](backend.md) plugin holds, such as the session that `accounts.backend.get` returns.

```ts
const accounts = Accounts.create({ plugins: [backend(), viem(), mpp()] })

const session = await accounts.backend.get({ id })
const response = await accounts.mpp({ session }).fetch(url)
```

A session manager holds its channel in memory. The [backend playground](https://github.com/tempoxyz/id/tree/main/playgrounds/backend) serves each request apart, so it opens a session, pays two requests, and closes the session in one request.

## Learn more

- [Access keys](access-keys.md)
- [Backends](backend.md)
- [Viem](viem.md)
