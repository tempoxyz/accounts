# viem

## Overview

The plugin of the Viem client, which adds `accounts.viem`. `accounts.viem` is a Tempo client from `viem/tempo`, on the instance's chain, whose account follows the instance's session. Each sign-in sets the account, and a sign-out empties it, so no Viem action passes `account`. A call, `accounts.viem({ … })`, returns a client with overrides, such as another chain, or a fixed `session` for one request on a backend.

The instance also holds the default client's actions and action groups, such as `accounts.token.transferSync()`, `accounts.sendTransaction()`, and `accounts.signMessage()`. Each reads the default client. The client's settings stay on `accounts.viem` alone: its `account`, `chain`, `transport`, and `extend`, since `accounts.account` is the instance's own. Viem's standalone actions take the client, such as `signMessage(accounts.viem, { message })`.

| Signature               | Signer on a page                                                              | Signer outside a page, and for a fixed `session` |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------ |
| Transactions            | The access key                                                                | The access key                                   |
| Messages and typed data | The account's owner until the chain holds the access key, then the access key | The access key                                   |

The account's owner is the cloud wallet through Tempo ID, or the account's passkey. An access key signs a message or typed data in a keychain envelope for the Tempo Account, which `accounts.verifyMessage` and `verifyTypedData` verify, as [Sign a message](../guides/viem.md#sign-a-message-as-the-tempo-account) describes. A verifier accepts that signature only after the access key's first transaction registers it on the chain. The clients' `verifyHash`, `verifyMessage`, and `verifyTypedData` take the user's `accessToken` for the app. An access key's signature counts only when the token's [`access_keys`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#access-keys) names the access key, so another app's access key on the same account does not. Without `accessToken`, an access key's signature does not count. A call that names a `mode` verifies with Viem alone.

On a page, each signature of a message or typed data reads the access key with Viem's `Actions.accessKey.getMetadata` on the client's chain. The access key signs while the chain holds it, and the read runs again at each signature, since the user can revoke the access key at any time. The owner signs before the registration, after a revocation, for an expired or revoked access key, after a failed read, and for a session without an access key on the chain. If no owner signs alone, such as passkeys below the threshold, the access key signs. Before the registration, a cloud wallet signs only for an app with the `tempo-id:sign` scope, on a chain with configurable accounts. Outside a page, a session without an access key on the chain signs through the owner too. If Tempo ID refuses it with [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted) or [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled), the access key signs, and its signature verifies once the first transaction registers the access key.

On a page, a transaction of the session's access key that the node refuses for a common reason retries, as [`retry`](#retry-optional) describes: Tempo ID's screen that fixes the failure shows, and the same transaction sends again.

The access key attaches its key authorization to transactions until the chain registers the access key. `accessKey.revoke` and `accessKey.updateLimit`, and their `Sync` forms, change an access key through Tempo ID with the account's owner, since the chain refuses keychain changes from an access key.

## Usage

```ts
import { Accounts } from 'accounts'
import { email, viem } from 'accounts/plugins'
import { Addresses } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'

const accounts = Accounts.create({ plugins: [email(), viem()] })

await accounts.email.signIn({ code, email: address })
const { receipt } = await accounts.token.transferSync({
  amount: 10_000n,
  to: '0x…',
  token: Addresses.ousd,
})
```

## Return type

`Plugin<'viem', viem.Namespace>`

### viem

- **Type:** `viem.Client & ((overrides?: viem.Overrides) => viem.Client)`

The default client: the instance's chain, its transport, and an account that follows the instance's session. A read of the account while the instance holds no session throws [`Accounts.SignedOutError`](errors.md#accountssignedouterror). Each Viem action of `viem/tempo` is a member, such as `accounts.token.transferSync`.

A call returns a client with the overrides of [`accounts.viem(overrides)`](#overrides). A call that names at most `chainId` returns one cached client for each chain.

```ts
await accounts.token.transferSync({ amount, to, token: Addresses.ousd })
await accounts
  .viem({ chainId: tempoTestnet.id })
  .token.transferSync({ amount, to, token: Addresses.ousd })
```

### viem.accessKey

- **Type:** `{ revoke; revokeSync; updateLimit; updateLimitSync }`

Viem's `accessKey` actions that change an access key, through Tempo ID with the account's owner. Each returns what Viem's own action returns. They need the app's `tempo-id:sign` scope, an access key that Tempo ID signed for the user, and a sign-in within the last 10 minutes. An access key that the chain has not registered registers with the new limit. With an `account` in the parameters, such as the account's root key, each is Viem's own action.

```ts
await accounts.accessKey.updateLimitSync({
  accessKey,
  limit: 5_000_000n,
  token: Addresses.ousd,
})
const { receipt } = await accounts.accessKey.revokeSync({ accessKey })
```

## Parameters

The plugin takes options, or a function that returns the options of a chain by its ID. The options are those of `createClient` from `viem/tempo` but `account`, `chain`, and `testnet`, such as `feeToken` and `transport`, and these. A chain ID is valid when it names a Tempo chain, or when its options name a `chain` of that ID.

```ts
const accounts = Accounts.create({
  plugins: [
    viem((chainId) => ({ transport: http(`https://rpc.example/${chainId}`) })),
  ],
})
```

### accessTokens (optional)

- **Type:** `{ clientIds?: readonly string[]; issuer?: string; maxAge?: number }`
- **Default:** the instance's issuer and client ID

The options of the verifier that `verifyHash`, `verifyMessage`, and `verifyTypedData` read `accessToken` with: `clientIds`, the client IDs of the apps whose tokens it accepts, `issuer`, Tempo ID's public origin, and `maxAge`, how long it keeps a key set, in milliseconds (default 10 minutes). Set `issuer` for a backend that reaches Tempo ID at an internal `url`, and `clientIds` for one that accepts the tokens of several apps.

```ts
const accounts = Accounts.create({
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
const accounts = Accounts.create({
  chainId: tempoLocalnet.id,
  plugins: [viem({ chain: tempoLocalnet.extend({ feeToken: pathUsd }) })],
})
```

### retry (optional)

- **Type:** `boolean | { balance?: boolean; key?: boolean; limit?: boolean; signal?: AbortSignal }`
- **Default:** `true`

Which refused transactions of the session's access key retry on a page. A retry first shows Tempo ID's screen that fixes the failure, and then sends the same transaction again, with no other action from the app. `false` turns every retry off. An object turns off each kind with `false`, and the other kinds stay on.

| Kind      | Chain errors                                         | Screen                                                                                                |
| --------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `balance` | `InsufficientBalance`, `InsufficientFeeTokenBalance` | The deposit page in a frame, with the amount and token that the error names. It retries on `received` |
| `key`     | `KeyNotFound`, `KeyExpired`, `KeyAlreadyRevoked`     | The embedded sign-in, for a new access key with the same limits and scopes                            |
| `limit`   | `SpendingLimitExceeded`                              | The embedded sign-in, for a new access key with the same limits and scopes                            |

A retry runs only when the node refused the transaction before it took it, from `eth_fillTransaction`, `eth_estimateGas`, or `eth_sendRawTransaction`. A transaction that reverted on the chain, or a request that did not reach the node, rejects with its error, so a retry never sends one transaction twice. Each kind retries once for each call, and a second failure of the kind rejects with its error. Concurrent failures that one screen resolves share it: a deposit of one token on one chain, or one sign-in on one chain. Other errors, such as `CallNotAllowed`, reject with Viem's `TempoExecutionError`.

A retry covers only the actions that send a transaction from the client's account. These reject as they are:

- Actions that send nothing, such as `estimateGas`, `fillTransaction`, `prepareTransactionRequest`, `simulateContract`, and an action's own `estimateGas` or `simulate`.
- Calls that name their own `account`, such as the account's root key.

Each screen shows without a click: the deposit page at `/embed/deposit`, and the sign-in at `/embed`. Where only a popup can show it, such as Buy MACH for a hint of `MACH` on Tempo mainnet on iOS and iPadOS, or the sign-in of an app without `tempo-id:iframe` in a browser without IntersectionObserver v2, a dialog offers **Continue**, whose click opens the popup. The new access key keeps the old one's expiry while it is in the future. An expired access key's replacement takes the expiry of the instance's [`accessKey`](Accounts.create.md), or the one that Tempo ID fills. A sign-in that returns another user or Tempo Account sets no session, and the call rejects with [`Plugins.viem.RetryAccountError`](#pluginsviemretryaccounterror). A fixed `session`, and a client outside a page, never retry. A retry covers the client's own actions, also on a client that `extend` returns, such as `accounts.token.transferSync()`. It does not cover Viem's standalone actions that take the client.

`signal` rejects the call with the signal's reason, and closes the screen that the call opened. A call that waits on a screen that another call opened stops its own wait.

```ts
const accounts = Accounts.create({
  plugins: [viem({ retry: { limit: false } })],
})
```

### relay (optional)

- **Type:** `string`

The URL of the app's relay route, which the [`relay`](plugins.relay.md) plugin serves. The chain's transport then sends each fill, and each raw transaction without its fee payer's signature, to the route, and every other request over `transport`. The relay's fee payer pays the fees of each transaction. In the object form, it applies to the same chain as `transport`, and other chains pay their own fees. A call's `transport` override sends without it.

```ts
const accounts = Accounts.create({
  plugins: [dialog(), viem({ relay: '/api/relay' })],
})
```

### transport (optional)

- **Type:** `Transport`
- **Default:** `http()`, the chain's own RPC

The transport of the chain's clients. In the object form, it applies to the options' `chain`, or to the instance's chain without one, and other chains use `http()`. A function of the plugin returns a transport for each chain. A transport to a sponsor relay, such as the Tempo API's `/rpc/relay`, lets the relay's fee payer pay for each transaction, as [Sponsor fees](../guides/viem.md#sponsor-fees) describes.

```ts
const accounts = Accounts.create({
  plugins: [viem({ transport: http('https://rpc.example') })],
})
```

### Overrides

`accounts.viem(overrides)` takes the options of `createClient` from `viem/tempo` but `account`, `chain`, and `testnet`, such as `transport`, and these:

#### chainId (optional)

- **Type:** `number`
- **Default:** The instance's `chainId`

The chain ID: a Tempo chain, or one whose options name its `chain`. The session's access key authorizes one chain. On another chain, the client's account keeps the address of the access key's account, `session.key.account`, and a transaction throws `Accounts.KeyRequiredError`.

Configurable accounts (TIP-1107) are enabled per chain, and they change the account's address:

| Chain                         | Tempo Account                              | Address                                  |
| ----------------------------- | ------------------------------------------ | ---------------------------------------- |
| With configurable accounts    | A contract account that its owners control | Derived from its configuration of owners |
| Without configurable accounts | The owner key itself                       | The owner key's own address              |

So `session.key.account` is the account's address on another chain only when both chains have configurable accounts, or neither does.

```ts
const client = accounts.viem({ chainId: tempoTestnet.id })
```

#### retry (optional)

- **Type:** `boolean | { balance?: boolean; key?: boolean; limit?: boolean; signal?: AbortSignal }`
- **Default:** The plugin's [`retry`](#retry-optional)

Which refused transactions of the client retry, for one call. A boolean replaces the plugin's `retry`. An object turns on or off the kinds that it names, over the plugin's, and keeps the plugin's other kinds.

```ts
const controller = new AbortController()
await accounts
  .viem({ retry: { signal: controller.signal } })
  .token.transferSync({ amount, to, token: Addresses.ousd })
```

#### session (optional)

- **Type:** [`Session`](types.md#session)

A fixed session, such as one that [`backend.get`](plugins.backend.md#backendget) returns, whose access key signs. On a server, use it in place of the default client, which follows the instance's own session.

```ts
const session = await accounts.backend.get({ id })
if (session)
  await accounts
    .viem({ session })
    .token.transferSync({ amount, to, token: Addresses.ousd })
```

> [!WARNING]
> Do not keep a client of a fixed session beyond its request. Its account signs with that one user's access key.

## Errors

### `Error`

Thrown when `chainId`, or the instance's `chainId`, is not a Tempo chain and its options name no `chain`. Return the chain's definition as `chain`.

### `Accounts.KeyRequiredError`

Thrown by a transaction of an account whose session holds no access key, and by `accounts.viem({ session })` for a session without an access key.

### `Accounts.SignedOutError`

Thrown when an action reads the account while the instance holds no session.

### `Accounts.ChainUnavailableError`

Thrown when the account's owner signs on a chain that Tempo ID does not list.

### `Plugins.viem.RetryAccountError`

Thrown by a transaction whose retry signed in for a new access key, when the sign-in returned another user or Tempo Account. The instance keeps its session, and the transaction did not send. Its `kind` is `key` or `limit`, and its `cause` is the transaction's error.

### `Plugins.viem.RetryClosedError`

Thrown by a transaction whose retry the user ended: a close of the deposit page before a deposit, **Continue to** the app without one, or a close of the sign-in for a new access key. Its `kind` is `balance`, `key`, or `limit`, and its `cause` is the transaction's error. The transaction did not send. Send it again to retry.

### `Accounts.RevokedError`

Thrown by `accessKey.revoke` and `accessKey.revokeSync` without `account` for an access key that the chain holds revoked already.

### `Accounts.RequestError`

Thrown when Tempo ID refuses a signature or an access key change, with its `reason`.

#### signMessage and signTypedData

- [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted): The page is not the page of a first-party app with the `tempo-id:sign` scope, or `clientId` names another app.
- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID.
- [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled): The chain's accounts are not configurable.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The account is not the user's in the app's realms.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): No cloud wallet of the user owns the account on the chain. Sign with the account's passkey.
- [`config_conflict`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#config_conflict): The chain holds a configuration that Tempo ID did not send.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): `message` is empty or too long, or `account` is not an address.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account requests. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the cloud wallet's provider failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### accessKey.revoke and accessKey.revokeSync

- [`invalid_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_token): With `accessToken`, the token is malformed, expired, or revoked, or belongs to another app than `clientId`.
- [`invalid_dpop_proof`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_dpop_proof): With a DPoP `accessToken`, the proof is missing, invalid, or replayed.
- [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted): The page is not the page of a first-party app with the `tempo-id:sign` scope, or `clientId` names another app. Only without `accessToken`.
- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): Without `accessToken`, the user is not signed in to Tempo ID.
- [`reauthentication_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reauthentication_required): Without `accessToken`, the session signed in more than 10 minutes before. Confirm the sign-in, then retry.
- [`unknown_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unknown_key): The user holds no live access key at the address on the account and chain, or, with `accessToken`, none that Tempo ID signed for the app.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The account is not the user's in the realms of the app that `clientId` names.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): No cloud wallet of the user owns the account on the chain. Revoke with the account's passkey, or on the permissions page.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): An address or the chain ID is malformed.
- [`insufficient_balance`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#insufficient_balance): The account cannot pay the network fee of the transaction, and no sponsor pays it. Add funds to the account, then retry.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account requests. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the cloud wallet's provider failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### accessKey.updateLimit and accessKey.updateLimitSync

Thrown when Tempo ID refuses the request without `redirect`, with one of these `reason` values. The approval page returns the same reasons to the redirect URI as `error_description`, and a visitor without a session as `error=login_required`.

- [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted): The page is not the page of a first-party app with the `tempo-id:sign` scope, or `clientId` names another app.
- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID.
- [`reauthentication_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reauthentication_required): The session signed in more than 10 minutes before. Confirm the sign-in, then retry.
- [`unknown_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unknown_key): The user holds no live access key at the address on the account and chain, or, on the approval page, none of the app's.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The account is not the user's in the realms of the app that `clientId` names.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): No cloud wallet of the user owns the account on the chain. Change the access key on the approval page, where the passkey signs.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): The access key is revoked, with `field: "address"`. Or a token of `limits` is one that the access key has no limit of, or appears twice, with `field` on that token. Or the request names neither `limits` nor `scopes`, or a field is malformed.
- An [access key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules), such as [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), with `field` on the scope, such as `scopes.0.recipients`.
- [`insufficient_balance`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#insufficient_balance): The account cannot pay the network fee of the transaction, and no sponsor pays it. Add funds to the account, then retry.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account requests. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the cloud wallet's provider failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
