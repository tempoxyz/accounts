# viem

## Overview

The plugin of the Viem client, which adds `tempoId.viem`. `tempoId.viem` is a Tempo client from `viem/tempo`, on the instance's chain, whose account follows the instance's session. Each sign-in sets the account, and a sign-out empties it, so no Viem action passes `account`. A call, `tempoId.viem({ … })`, returns a client with overrides, such as another chain, or a fixed `session` for one request on a backend.

The instance also holds the default client's actions and action groups, such as `tempoId.token.transferSync()`, `tempoId.sendTransaction()`, and `tempoId.signMessage()`. Each reads the default client. The client's settings stay on `tempoId.viem` alone: its `account`, `chain`, `transport`, and `extend`, since `tempoId.account` is the instance's own. Viem's standalone actions take the client, such as `signMessage(tempoId.viem, { message })`.

| Signature               | Signer on a page                                                              | Signer outside a page, and for a fixed `session` |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Transactions            | The access key                                                                | The access key                                   |
| Messages and typed data | The account's owner until the chain holds the access key, then the access key | The access key                                   |

The account's owner is the cloud wallet through Tempo ID, or the account's passkey. An access key signs a message or typed data in a keychain envelope for the Tempo Account, which `tempoId.verifyMessage` and `verifyTypedData` verify, as [Sign a message](../guides/viem.md#sign-a-message-as-the-tempo-account) describes. A verifier accepts that signature only after the access key's first transaction registers it on the chain. The clients' `verifyHash`, `verifyMessage`, and `verifyTypedData` take the user's `accessToken` for the app. An access key's signature counts only when the token's [`access_keys`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#access-keys) names the access key, so another app's access key on the same account does not. Without `accessToken`, an access key's signature does not count. A call that names a `mode` verifies with Viem alone.

On a page, each signature of a message or typed data reads the access key with Viem's `Actions.accessKey.getMetadata` on the client's chain. The access key signs while the chain holds it, and the read runs again at each signature, since the user can revoke the access key at any time. The owner signs before the registration, after a revocation, for an expired or revoked access key, after a failed read, and for a session without an access key on the chain. If no owner signs alone, such as passkeys below the threshold, the access key signs. Before the registration, a cloud wallet signs only for an app with the `tempo-id:sign` scope, on a chain with configurable accounts. Outside a page, a session without an access key on the chain signs through the owner too. If Tempo ID refuses it with [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted) or [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled), the access key signs, and its signature verifies once the first transaction registers the access key.

The access key attaches its key authorization to transactions until the chain registers the access key. `accessKey.revoke` and `accessKey.updateLimit`, and their `Sync` forms, change an access key through Tempo ID with the account's owner, since the chain refuses keychain changes from an access key.

## Usage

```ts
import { Id } from '`tempoxyz/id'
import { email, viem } from '`tempoxyz/id/plugins'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

const tempoId = Id.create({ plugins: [email(), viem()] })

await tempoId.email.signIn({ code, email: address })
const { receipt } = await tempoId.token.transferSync({
  amount: 10_000n,
  to: '0x…',
  token: ousd,
})
```

## Return type

`Plugin<'viem', viem.Namespace>`

### viem

- **Type:** `viem.Client & ((overrides?: viem.Overrides) => viem.Client)`

The default client: the instance's chain, its transport, and an account that follows the instance's session. A read of the account while the instance holds no session throws [`Id.SignedOutError`](errors.md#idsignedouterror). Each Viem action of `viem/tempo` is a member, such as `tempoId.token.transferSync`.

A call returns a client with the overrides of [`tempoId.viem(overrides)`](#overrides). A call that names at most `chainId` returns one cached client for each chain.

```ts
await tempoId.token.transferSync({ amount, to, token: ousd })
await tempoId
  .viem({ chainId: tempoTestnet.id })
  .token.transferSync({ amount, to, token: ousd })
```

### viem.accessKey

- **Type:** `{ revoke; revokeSync; updateLimit; updateLimitSync }`

Viem's `accessKey` actions that change an access key, through Tempo ID with the account's owner, as [`Actions.account.revokeKey`](Actions.account.revokeKey.md) and [`Actions.account.updateKey`](Actions.account.updateKey.md) describe. Each returns what Viem's own action returns. They need the app's `tempo-id:sign` scope, an access key that Tempo ID signed for the user, and a sign-in within the last 10 minutes. An access key that the chain has not registered registers with the new limit. With an `account` in the parameters, such as the account's root key, each is Viem's own action.

```ts
await tempoId.accessKey.updateLimitSync({
  accessKey,
  limit: 5_000_000n,
  token: ousd,
})
const { receipt } = await tempoId.accessKey.revokeSync({ accessKey })
```

## Parameters

The plugin takes options, or a function that returns the options of a chain by its ID. The options are those of `createClient` from `viem/tempo` but `account`, `chain`, and `testnet`, such as `feeToken` and `transport`, and these. A chain ID is valid when it names a Tempo chain, or when its options name a `chain` of that ID.

```ts
const tempoId = Id.create({
  plugins: [
    viem((chainId) => ({ transport: http(`https://rpc.example/${chainId}`) })),
  ],
})
```

### accessTokens (optional)

- **Type:** `AccessToken.create.Options`
- **Default:** the instance's issuer and client ID

The options of the verifier that `verifyHash`, `verifyMessage`, and `verifyTypedData` read `accessToken` with, as [`AccessToken.create`](AccessToken.create.md) takes them. Set `issuer` for a backend that reaches Tempo ID at an internal `url`, and `clientIds` for one that accepts the tokens of several apps.

```ts
const tempoId = Id.create({
  clientId,
  plugins: [viem({ accessTokens: { issuer: 'https://id.tempo.xyz' } })],
  url: 'http://id.internal',
})
```

### chain (optional)

- **Type:** `Chain`
- **Default:** Tempo's chain of the chain ID: mainnet, testnet, devnet, or a local node

The chain of the options' chain ID, such as one with a `feeToken` or another RPC URL. A chain of another ID does not apply, so the object form names one chain. A chain ID that is not Tempo's needs a `chain`, or a read of its client throws.

```ts
const tempoId = Id.create({
  chainId: tempoLocalnet.id,
  plugins: [viem({ chain: tempoLocalnet.extend({ feeToken: pathUsd }) })],
})
```

### relay (optional)

- **Type:** `string`

The URL of the app's relay route, which the [`relay`](plugins.relay.md) plugin serves. The chain's transport then sends each fill, and each raw transaction without its fee payer's signature, to the route, and every other request over `transport`. The relay's fee payer pays the fees of each transaction. In the object form, it applies to the same chain as `transport`, and other chains pay their own fees. A call's `transport` override sends without it.

```ts
const tempoId = Id.create({
  plugins: [dialog(), viem({ relay: '/api/relay' })],
})
```

### transport (optional)

- **Type:** `Transport`
- **Default:** `http()`, the chain's own RPC

The transport of the chain's clients. In the object form, it applies to the options' `chain`, or to the instance's chain without one, and other chains use `http()`. A function of the plugin returns a transport for each chain. A transport to a sponsor relay, such as the Tempo API's `/rpc/relay`, lets the relay's fee payer pay for each transaction, as [Sponsor fees](../guides/viem.md#sponsor-fees) describes.

```ts
const tempoId = Id.create({
  plugins: [viem({ transport: http('https://rpc.example') })],
})
```

### Overrides

`tempoId.viem(overrides)` takes the options of `createClient` from `viem/tempo` but `account`, `chain`, and `testnet`, such as `transport`, and these:

#### chainId (optional)

- **Type:** `number`
- **Default:** The instance's `chainId`

The chain ID: a Tempo chain, or one whose options name its `chain`. The session's access key authorizes one chain. On another chain, the client's account keeps the address of the access key's account, `session.key.account`, and a transaction throws `Id.KeyRequiredError`.

Configurable accounts (TIP-1107) are enabled per chain, and they change the account's address:

| Chain                         | Tempo Account                              | Address                                  |
| ----------------------------- | ------------------------------------------ | ---------------------------------------- |
| With configurable accounts    | A contract account that its owners control | Derived from its configuration of owners |
| Without configurable accounts | The owner key itself                       | The owner key's own address              |

So `session.key.account` is the account's address on another chain only when both chains have configurable accounts, or neither does.

```ts
const client = tempoId.viem({ chainId: tempoTestnet.id })
```

#### session (optional)

- **Type:** [`Session`](types.md#session)

A fixed session, such as one that [`backend.get`](plugins.backend.md#backendget) returns, whose access key signs. On a server, use it in place of the default client, which follows the instance's own session.

```ts
const session = await tempoId.backend.get({ id })
if (session)
  await tempoId
    .viem({ session })
    .token.transferSync({ amount, to, token: ousd })
```

> [!WARNING]
> Do not keep a client of a fixed session beyond its request. Its account signs with that one user's access key.

## Errors

### `Error`

Thrown when `chainId`, or the instance's `chainId`, is not a Tempo chain and its options name no `chain`. Return the chain's definition as `chain`.

### `Id.KeyRequiredError`

Thrown by a transaction of an account whose session holds no access key, and by `tempoId.viem({ session })` for a session without an access key.

### `Id.SignedOutError`

Thrown when an action reads the account while the instance holds no session.

### `Id.ChainUnavailableError`

Thrown when the account's owner signs on a chain that Tempo ID does not list.

### `Id.RevokedError`

Thrown by `accessKey.revoke` and `accessKey.revokeSync` without `account` for an access key that the chain holds revoked already.

### `Id.RequestError`

Thrown when Tempo ID refuses a signature or an access key change, as [`Actions.account.signMessage`](Actions.account.signMessage.md#errors), [`Actions.account.revokeKey`](Actions.account.revokeKey.md#errors), and [`Actions.account.updateKey`](Actions.account.updateKey.md#errors) list.
