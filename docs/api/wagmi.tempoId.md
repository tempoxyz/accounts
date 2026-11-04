# tempoId

## Overview

A [wagmi](https://wagmi.sh) connector, from `accounts/wagmi`, whose wallet is a Tempo ID instance. The instance's [session](types.md#session) is the connection: a sign-in connects, and a sign-out disconnects. `@wagmi/core` is an optional peer dependency of `accounts`, so an app with wagmi installs it beside the package.

The connector creates the instance on first use, with [`Accounts.create`](Accounts.create.md), from its options and the config's first chain. It adds the [`viem`](plugins.viem.md) plugin over the config's `chains` and `transports`. In a browser, it creates the instance as the config is created, so the dialog's frame preloads.

`connect` signs in as the table shows:

| Instance before `connect` | `connect` without `accessKey`                  | `connect` with `accessKey` |
| ------------------------- | ---------------------------------------------- | -------------------------- |
| Holds a session           | Returns the session's account, with no sign-in | Signs in again             |
| Holds no session          | Signs in                                       | Signs in                   |

A sign-in runs `signIn`, or the `signIn` of the first plugin of `plugins` that signs in without input: `device`, `dialog`, `passkey`, or `redirect`. An instance without a sign-in plugin holds [`dialog`](plugins.dialog.md). The `email` and `backend` plugins take input, so they need `signIn`. A session without an access key receives the Tempo Account that Tempo ID selects for the app, as [`accounts.account.get`](Accounts.create.md#accountget) returns it.

wagmi's actions use the instance's Viem client, so they sign as the [`viem`](plugins.viem.md) plugin does:

| Signature               | Signer                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transactions            | The access key                                                                                                                                               |
| Messages and typed data | On a page, the account's owner until the chain holds the access key, then the access key. Elsewhere, the access key, and the owner for a session without one |

`disconnect` signs the user out with [`accounts.signOut`](Accounts.create.md#signout). A sign-out through the instance itself disconnects wagmi too.

## Usage

```ts
import { connect, createConfig, http, signMessage } from '@wagmi/core'
import { tempoId } from 'accounts/wagmi'
import { tempo } from 'viem/tempo/chains'

const config = createConfig({
  chains: [tempo],
  connectors: [tempoId()],
  transports: { [tempo.id]: http() },
})

const { accounts } = await connect(config, {
  connector: config.connectors[0]!,
})
const signature = await signMessage(config, { message: 'hi' })
```

## Return type

`CreateConnectorFn<tempoId.Provider, tempoId.Properties>`

The connector function for `createConfig`'s `connectors`. The connector that wagmi creates from it has wagmi's members, and these:

### connect

- **Type:** `(parameters?: tempoId.ConnectParameters) => Promise<{ accounts; chainId }>`

Returns the session's account and the connector's chain, and signs the user in first as the [Overview](#overview) describes. wagmi's `connect` passes its parameters to it, so an app passes [`accessKey`](#accesskey-optional) and [`signIn`](#signin-optional) to wagmi's `connect`.

```ts
await connect(config, { accessKey: false, connector })
```

### getInstance

- **Type:** `() => Promise<Accounts.Accounts>`

Returns the connector's instance, and creates it on the first call. The instance holds the namespace of each plugin, such as `instance.email`, and the `viem` plugin's client.

```ts
const instance = await connector.getInstance()
await instance.email.sendCode({ email: address })
```

### getProvider

- **Type:** `(parameters?: { chainId?: number }) => Promise<tempoId.Provider>`

Returns an EIP-1193 provider over the instance's client of the chain, the connector's by default. It serves these methods with the instance, and sends every other method to the chain's RPC:

| Method                 | Result                                                                    |
| ---------------------- | ------------------------------------------------------------------------- |
| `eth_accounts`         | The session's account, or none while signed out                           |
| `eth_chainId`          | The chain's ID                                                            |
| `eth_requestAccounts`  | The session's account, after a sign-in when the instance holds no session |
| `eth_sendTransaction`  | The hash of the transaction, which the access key signs                   |
| `eth_signTypedData_v4` | The signature of the typed data                                           |
| `personal_sign`        | The signature of the message                                              |

The provider emits `accountsChanged` at a new session's account, and `disconnect` at a sign-out.

```ts
const provider = await connector.getProvider()
const signature = await provider.request({
  method: 'personal_sign',
  params: [toHex('hi'), address],
})
```

## Parameters

The connector takes the options of [`Accounts.create`](Accounts.create.md) but `chainId` and `dev`, since the config's first chain sets the chain. The connector adds the [`viem`](plugins.viem.md) plugin over the config's `chains` and `transports`. A `viem` plugin in `plugins` gives its other options to that plugin, such as a `feeToken`.

```ts
const connector = tempoId({
  accessKey: () => ({
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  }),
  plugins: [passkey(), viem({ feeToken: ousd })],
})
```

### Connect parameters

wagmi's `connect` passes these to the connector:

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The connector's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key. With it, `connect` signs in again over a held session.

```ts
await connect(config, { accessKey: false, connector })
```

#### signIn (optional)

- **Type:** `(instance: tempoId.Instance, parameters: { accessKey }) => Promise<unknown>`
- **Default:** The `signIn` of the first plugin that signs in without input

Signs the user in on the instance, and receives the call's `accessKey`. Absent `accessKey`, the instance's own applies.

```ts
await connect(config, {
  connector,
  signIn: (instance, { accessKey }) =>
    instance.email.signIn({ accessKey, code, email: address }),
})
```

## Errors

### `wagmi.SignInRequiredError`

Thrown by `connect` without `signIn` when the instance holds no session, and each of its sign-in plugins takes input, such as `email`.

### `wagmi.SignInIncompleteError`

Thrown by `connect` when the sign-in set no session: a redirect that left the page, a dismissed browser, or the email step of a passkey. After a redirect, wagmi's `reconnect` connects on the page that the browser returns to.

### `wagmi.AccountUnavailableError`

Thrown by `connect` when the session holds no access key, and Tempo ID returned no Tempo Account for the app.

### `wagmi.ChainSwitchError`

Thrown by `switchChain`, and by `connect` with `chainId`, for a chain other than the connector's. A session and its access key belong to one chain.

### `Provider.UnauthorizedError`

Thrown by the provider's `personal_sign`, `eth_signTypedData_v4`, and `eth_sendTransaction` for an address other than the session's account.

### `Accounts.RequestError`

Thrown when Tempo ID refuses the sign-in, or the read of the Tempo Account, as each plugin's page lists.

The client's account throws [`Accounts.KeyRequiredError`](errors.md#accountskeyrequirederror) for a transaction of a session without an access key, as [`viem`](plugins.viem.md#errors) lists.
