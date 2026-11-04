# mpp

## Overview

A plugin, from `accounts/mpp`, that adds `accounts.fetch` and `accounts.mpp`, which pay the 402 challenges of Machine Payments Protocol (MPP) endpoints through [mppx](https://github.com/wevm/mppx). The access key of the instance's session signs every charge, proof, and voucher, so no payment reaches the account's owner. `mppx` is an optional peer dependency of `accounts`, so an app that pays MPP endpoints installs it beside the package.

The plugin reads the chain and transport of each chain ID from the [`viem`](plugins.viem.md) plugin. Without a `viem` plugin in `plugins`, it uses a `viem` plugin of its own, with Tempo's chains and their own RPC.

| Member                   | Returns                                                                     |
| ------------------------ | --------------------------------------------------------------------------- |
| `accounts.fetch`         | `fetch` that pays each charge with the access key of the instance's session |
| `accounts.mpp.session()` | A session manager, which pays each request of a channel with a voucher      |
| `accounts.mpp({ … })`    | A payer with overrides, such as a fixed `session` or a `maxAmount`          |

## Usage

```ts
import { Accounts } from 'accounts'
import { mpp } from 'accounts/mpp'
import { dialog } from 'accounts/plugins'

const accounts = Accounts.create({ accessKey, plugins: [dialog(), mpp()] })

await accounts.dialog.signIn()
const response = await accounts.fetch('https://api.example.com/fortune')
```

## Return type

`Plugin<'mpp'>`

The plugin adds two members to the instance. Each reads the instance's session at each payment, and `fetch` loads the stored session first, such as after a reload.

### fetch

- **Type:** `(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>`

The `fetch` of the payer of the instance's session, as below.

### mpp

- **Type:** `mpp.Namespace`

The `session` of the payer of the instance's session. A call returns a payer with overrides. Each payer has two members:

- `fetch(input, init?)`: Sends the request. A 402 charge challenge starts a payment with the access key, and the retry returns the endpoint's response. A request without a session rejects with `Accounts.SignedOutError`, and a session without an access key with `Accounts.KeyRequiredError`.
- `session(parameters?)`: Returns a session manager of mppx. Its first request opens a channel on the TIP-1034 channel reserve, each request pays with a voucher of the access key, and `close()` closes the channel. The manager holds the channel in memory, so close it before it is discarded. `parameters` takes the options of mppx's `tempo.session.manager` but the account and the client, such as `maxDeposit`. It reads the session without loading it, so read the session first after a reload or a restart, such as with `accounts.session.get()`.

```ts
const session = accounts.mpp.session()
try {
  await session.fetch('https://api.example.com/content')
} finally {
  await session.close()
}
```

## Parameters

The plugin's options set every payer. A call's overrides take `maxAmount`, `maxDeposit`, and `mode` too, and win over the plugin's.

### accessKey (optional, overrides only)

- **Type:** `Account`
- **Default:** none

The access key that the app supplied to the sign-in, which signs for a session's access key without material. Without it, a payment with such an access key throws `AccessKey.AccessKeyRequiredError`.

### fetch (optional)

- **Type:** `typeof globalThis.fetch`
- **Default:** the global `fetch`

Sends each request to an endpoint, and its paid retry.

### maxAmount (optional)

- **Type:** `string`
- **Default:** no maximum, within the access key's token limits

The most that a charge may cost, in the units of its token, such as `'0.1'`, with at most 6 decimals. A larger charge throws `mpp.MaxAmountError` before the access key signs, and a finer `maxAmount` throws `mpp.MaxAmountPrecisionError`.

### maxDeposit (optional)

- **Type:** `string`
- **Default:** the deposit that the endpoint suggests, within the access key's token limits

The most that a session's channel holds, in the units of its token. It caps the deposit that an endpoint suggests and each automatic top-up. A manager's own `topUp(amount)` adds `amount` as given, so the app bounds it.

### mode (optional)

- **Type:** `'pull' | 'push'`
- **Default:** `'pull'`

Who broadcasts a charge's transaction: the endpoint (`'pull'`) or the app (`'push'`).

### session (optional, overrides only)

- **Type:** [`Session`](types.md#session)
- **Default:** the instance's session, read at each payment

A fixed session, such as one that `accounts.backend.get` returns, whose access key pays.

```ts
mpp({ maxAmount: '1', maxDeposit: '0.05' })

await accounts.mpp({ mode: 'push', session }).fetch(url)
```

## Errors

### `mpp.MaxAmountError`

A charge costs more than `maxAmount`, so the payer signs nothing.

### `mpp.MaxAmountPrecisionError`

`maxAmount` names more than 6 decimals, which a TIP-20 token cannot hold, so the payer signs nothing.

### `Accounts.SignedOutError`

A payment of the instance's session while it holds none.

### `Accounts.KeyRequiredError`

A payment of a session without an access key.

### `AccessKey.AccessKeyRequiredError`

A payment with an access key without material, and no `accessKey` override.

### `Error`

A payment on a chain that is not a Tempo chain, when the `viem` plugin's options name no `chain` of that ID.
