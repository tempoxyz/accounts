# Types

## Overview

Each type lives in its own module of `accounts`, named after it, such as `Permissions.Permissions`. `Authorization`, `Funding`, `Pending`, and `User` come from `accounts/internal`, since the actions build and return them. Each module has a `from`, which returns its value with the type. `Id.Config` is the exception: [`Id.from`](Id.from.md) returns it with its defaults.

## Usage

```ts
import { Permissions } from 'accounts'

const permissions = Permissions.from({
  expiry: '1d',
  limits: [{ limit: '10', token: 'ousd' }],
})
```

## AccessKey

`AccessKey.AccessKey` is an app's access key as the app stores it. An access key that the app supplied as `accessKey.account` carries no material. `AccessKey.from` fills an absent `chainId` from the key authorization.

### account

- **Type:** `Address`

The Tempo Account the access key acts for.

### chainId

- **Type:** `number`

The chain the access key acts on, from its authorization.

### keyAuthorization

- **Type:** `KeyAuthorization.Rpc`, from `ox/tempo`

The signed authorization, in the node's RPC format.

### keyPair (optional)

- **Type:** `WebCryptoP256.createKeyPair.ReturnType`, from `ox`

A non-extractable WebCrypto P256 key pair, in a browser. IndexedDB stores it without exporting it.

### privateKey (optional)

- **Type:** `Hex`

A secp256k1 private key, outside a browser. Keep it as secret as a session.

## Authorization

`Authorization.Authorization` is what every sign-in returns: the [`Tokens.Tokens`](#tokens), the access key, and the user. It is what each low-level sign-in action of [`Actions`](Actions.md) returns. Its `chainId` type parameter types `key.chainId`, as a literal for a literal `accessKey.chainId`. An instance's sign-in returns a [`Session`](#session) instead.

### accessKey

- **Type:** `Account.AccessKeyAccount`, from `viem/tempo`

The app's access key, as a Viem account at the user's Tempo Account, from [`AccessKey.toAccount`](AccessKey.toAccount.md). It signs transactions, messages, and typed data with the access key, within the access key's limits, scopes, and expiry. Pass it as `account` to a Viem action, such as `client.token.transferSync({ account: authorization.accessKey, … })`.

### key

- **Type:** [`AccessKey.AccessKey`](#accesskey)

The same access key as data, which [`AccessKey.toAccount`](AccessKey.toAccount.md) rebuilds into `accessKey`.

### user

- **Type:** [`User.User`](#user)

The signed-in user, from the ID token.

## BackendSession

A backend session is the session that the [`backend`](plugins.backend.md) plugin's `complete` and `get` return. Its refresh token and ID token stay in the plugin's store. The package exports no name for the type.

### accessToken

- **Type:** `string`

The access token for Tempo APIs: a Bearer token, or a DPoP token from an instance with `dpop`.

### account (optional)

- **Type:** [`TempoAccount.TempoAccount`](#tempoaccount)

The user's Tempo Account. Absent after a sign-in through a redirect, which reads no account.

### expiresAt

- **Type:** `number`

When the access token expires, in milliseconds.

### key (optional)

- **Type:** [`AccessKey.AccessKey`](#accesskey)

The app's access key, with its private key. [`tempoId.viem({ session })`](plugins.viem.md#session-optional) signs with it. Absent after a sign-in without an access key.

### sid (optional)

- **Type:** `string`

The Tempo ID session that signed the user in, as the ID token's `sid`. A [logout token](LogoutToken.create.md) names it as `sessionId`. Absent when the ID token holds no `sid`, as for an app without a back-channel logout URI.

### user

- **Type:** [`User.User`](#user)

The signed-in user.

## Config

`Id.Config` is the configuration of an instance, `tempoId.config`, which every action of [`Actions`](Actions.md) takes. [`Id.from`](Id.from.md) returns it with its defaults, and [`Id.from`](Id.from.md#parameters) documents each option.

### chainId

- **Type:** `number`

The chain the app's access keys act on, unless an action's `accessKey` names another.

### clientId

- **Type:** `string`

The app's client ID: from its registration, the URL of its metadata document, its origin, or `cli:` and a CLI's name. In a browser, it defaults to the page's origin.

### clientAssertion (optional)

- **Type:** `ClientAssertion.Signer`

Signs a [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions) for each request that authenticates the app, such as [`ClientAssertion.fromPrivateKey`](ClientAssertion.fromPrivateKey.md) returns. Only a backend holds one.

### clientSecret (optional)

- **Type:** `string`

The app's client secret. Only a backend holds one.

### dpop (optional)

- **Type:** [`Dpop.Dpop`](#dpop)

The key that binds the app's tokens. Each token request sends a proof from it.

### fetch (optional)

- **Type:** `typeof globalThis.fetch`

Calls Tempo ID.

### par (optional)

- **Type:** `boolean`

Whether a redirect or a dialog pushes each authorization request to `/oauth2/par`, so the app's redirect holds only a reference to it. The plugin of the flow sets it. Defaults to `true` for an instance with `clientSecret` or `clientAssertion`.

### redirectUri (optional)

- **Type:** `string`

Where Tempo ID redirects back to.

### scope

- **Type:** `string`

The scopes of the app's tokens, always with `openid` and `email`.

### store (optional)

- **Type:** [`Store.Store`](#store)

Where the instance keeps its session, and where a redirect keeps its state until Tempo ID redirects back. Defaults to IndexedDB in a browser. Outside a browser, the instance holds a session only with a store.

### url

- **Type:** `string`

Where Tempo ID runs, such as `https://id.tempo.xyz`.

## Dpop

`Dpop.Dpop` is a [DPoP key](https://github.com/tempoxyz/id/blob/main/docs/dpop.md), which [`Dpop.create`](Dpop.create.md) generates or [`Dpop.fromKeyPair`](Dpop.fromKeyPair.md) reads from an access key's WebCrypto key pair, and [`Dpop.proof`](Dpop.proof.md) signs with. `Dpop.from` returns a stored key with the type.

### jwk

- **Type:** `{ crv: string; kty: string; x: string; y: string }`

The public P-256 key as a JWK, which each proof's header carries.

### privateKey

- **Type:** `CryptoKey`

The private key, which signs each proof with ES256. IndexedDB stores it as it is, without its private bytes when it is non-extractable.

## Funding

`Funding.Funding` is a [funding hint](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md): the amount that an app needs in the user's Tempo Account, which the `funding` of [`redirect.signIn`](plugins.redirect.md#funding-optional), [`dialog.signIn`](plugins.dialog.md#funding-optional), [`device.signIn`](plugins.device.md#funding-optional), [`backend.start`](plugins.backend.md#funding-optional), and their low-level actions sends. [`funding.open`](plugins.funding.md#fundingopen) and [`Actions.funding.open`](Actions.funding.open.md#amount-optional) take its fields as `amount`, `currency`, and `token`, and send them to the deposit page, whose methods they select. `Funding.from` returns it with the type.

### amount

- **Type:** `string`

The amount, as a decimal string above 0, such as `10`. It is the request's `funding_hint`.

### currency (optional)

- **Type:** `string`
- **Default:** The currency of `token`, or `USD`

The ISO 4217 currency of `amount`, such as `EUR`. Every listed token of the currency counts toward the amount.

### token (optional)

- **Type:** `string`

The symbol or address of the only token that counts, such as `USDC.e`. Its currency must equal `currency`.

## Pending

`Pending.Pending` is a sign-in redirect in progress, which the app keeps until Tempo ID redirects back, with the key material of [`AccessKey.AccessKey`](#accesskey). `Pending.WithoutKey` authorizes no access key, and holds no material.

### key (optional)

- **Type:** `false`

`false` in a `Pending.WithoutKey`, and absent in a `Pending.Pending`.

### redirectUri

- **Type:** `string`

Where Tempo ID redirects back to, which the code exchange repeats.

### state

- **Type:** `string`

The value that the callback must echo, so the library refuses a forged callback.

### verifier

- **Type:** `string`

The PKCE verifier that redeems the code.

## Permissions

`Permissions.Permissions` is what an app's access key may do. [`Id.create`](Id.create.md#accesskey-optional) takes it, or a function that returns it, for each sign-in, and each sign-in and `authorize` take it as `accessKey`, or `false` for no access key. Each low-level action takes a [`Permissions.WithAccount`](#permissionswithaccount) as `accessKey`. [`Permissions.resolve`](Permissions.resolve.md) turns it into the key authorization request at each call, so a duration expiry counts from that call. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). Without `scopes`, the library fills them from `limits`. An access key that never expires (`expiry: false`), spends any amount (no `limits`), or makes any call (`scopes: 'any'`) is an [access key without bounds](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#access-keys-without-bounds), which only a headless sign-in of an app with `tempo-id:sign` may request. `from` keeps `chainId` as a literal type.

```ts
const permissions = Permissions.from({
  expiry: '1d',
  limits: [{ limit: '10', token: 'ousd' }],
})
```

Two types follow the `accessKey` of an action. `Permissions.Keyed<accessKey>` is `true` for an access key and `false` for `undefined`, which decides whether the result holds `accessKey` and `key`. `Permissions.ChainId<accessKey, fallback>` is the literal `chainId` that `accessKey` names, else `fallback`, such as the instance's chain, which types `key.chainId`.

### chainId (optional)

- **Type:** `number`
- **Default:** The instance's `chainId`

The chain the access key acts on.

### expiry (optional)

- **Type:** `Permissions.Duration | number | false`
- **Default:** The app's refresh token lifetime from the sign-in, at most one year, which Tempo ID fills

When the access key expires. A `Duration` is a whole number and a unit, such as `'30m'` or `'1d'`, that counts from the request: `s`, `m`, `h`, `d`, or `w`. A number is Unix seconds, such as `Expiry.days(1)` from Viem. `false` requests an access key that never expires, and the request sends an expiry of 0. Tempo ID accepts it only for a headless sign-in of a first-party app with the `tempo-id:sign` scope, and refuses it elsewhere with [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry).

Without `expiry`, the request sends no expiry, and Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry): the app's refresh token lifetime from the sign-in, at most one year. The default refresh token lifetime is 30 days.

### limits (optional)

- **Type:** `readonly Permissions.Limit[]`

How much of each token the access key may spend, such as `[{ limit: '10', token: 'ousd' }]`. Absent for an access key that spends any amount of any token, which only a headless sign-in of an app with `tempo-id:sign` may request. Each limit has these properties:

- `limit`: a decimal string in the token's units, such as `'10'`, or a bigint in base units, such as `10_000_000n`. A decimal string needs a token that the chain lists.
- `period` (optional): a `Duration`, such as `'1d'`, or whole seconds, after which the limit resets. Absent for a one-time total.
- `spenders` (optional): the contracts that the access key may `approve` to spend the token, which adds an `approve` scope to the filled scopes.
- `token`: the token's symbol on the chain, such as `'ousd'` or `'OUSD'`, or its address.

### scopes (optional)

- **Type:** `KeyAuthorization.KeyAuthorization['scopes'] | 'any'`, from `ox/tempo`

The calls the access key may make, such as `[Scopes.tip20(token).transfer()]` from Viem. Absent with `limits`, the scopes are `transfer` and `transferWithMemo` on each limited token, `approve` to each limit's `spenders`, and `open` and `topUp` on the TIP-1034 channel reserve, which MPP sessions pay through. Named scopes replace these. Absent without `limits`, the request sends no scopes, and the access key makes any call.

`'any'` sends no scopes, for an access key that makes any call, also with `limits`. Only a headless access key of an app with `tempo-id:sign` may make any call. Tempo ID refuses it elsewhere with [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions).

```ts
const permissions = Permissions.from({ expiry: false, scopes: 'any' })
```

### Permissions.WithAccount

`Permissions.WithAccount` is the `accessKey` of a low-level action of [`Actions`](Actions.md): the `Permissions.Permissions` above, and the app's own access key as `account`. Its `chainId` type parameter types `key.chainId` as `Permissions.Permissions` does.

```ts
const authorization = await Actions.authorize(config, {
  accessKey: {
    account,
    expiry: '1h',
    limits: [{ limit: '10', token: 'ousd' }],
  },
})
```

#### account (optional)

- **Type:** `Account.Account`, from `viem/tempo`
- **Default:** A new access key: WebCrypto P256 in a browser, secp256k1 elsewhere, whose material the result keeps

The app's own access key, as a Viem account. Its `access` names the Tempo Account, which defaults to the app's selected account, or the user's oldest. [`AccessKey.toAccount`](AccessKey.toAccount.md#accesskey-optional) takes the same account as its own `accessKey` option, since the stored access key then carries no material.

## Session

`Session.Session` is the session of a signed-in user, which an instance holds and saves to its store, and each sign-in of a plugin returns. It holds the [`Tokens.Tokens`](#tokens), the user, the app's access key as data, and the user's Tempo Account. [`Session.expired`](Session.expired.md) reports an access key past its expiry.

### account (optional)

- **Type:** [`TempoAccount.TempoAccount`](#tempoaccount)

The user's Tempo Account that Tempo ID selects for the app, on the instance's chain: the account that the user selected, else the oldest. Absent where the sign-in read no account, such as a sign-in through a redirect, a dialog, or a device. [`tempoId.account.get`](Id.create.md#accountget) reads it.

### accessToken

- **Type:** `string`

The access token for Tempo APIs: a Bearer token, or a [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) from an instance with `dpop`.

### expiresAt

- **Type:** `number`

When the access token expires, in milliseconds.

### idToken (optional)

- **Type:** `string`

The OIDC ID token, which names the user. A refresh may omit it.

### key (optional)

- **Type:** [`AccessKey.AccessKey`](#accesskey)

The app's access key, with its material. [`AccessKey.toAccount`](AccessKey.toAccount.md) rebuilds it into a Viem account, and the [`viem`](plugins.viem.md) plugin signs with it. Absent after a sign-in without an access key.

### refreshToken (optional)

- **Type:** `string`

Exchanges for new tokens through [`tempoId.session.refresh`](Id.create.md#sessionrefresh). It rotates on every refresh.

### user

- **Type:** [`User.User`](#user)

The signed-in user, from the ID token.

## Session.Status

`Session.Status` is the status of an instance's session, which [`tempoId.session.status`](Id.create.md#sessionstatus) and [`tempoId.useSession()`](react.react.md) return. An authorization of the browser's Tempo ID session, such as [`tempoId.authorize`](Id.create.md#authorize), holds it at `pending`, or at `reauthorizing` while it renews a saved session that expired.

| `status`        | `session`                 | When                                                                                                                |
| --------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pending`       | `undefined`               | The instance reads the saved session, completes a redirect's callback, or authorizes with no saved session to show. |
| `reauthorizing` | The expired saved session | An authorization renews a saved session whose access key expired. Its access key signs nothing.                     |
| `signedIn`      | The session               | The instance holds a session.                                                                                       |
| `signedOut`     | `undefined`               | The instance holds no session, and no authorization runs.                                                           |

### session

- **Type:** [`Session.Session`](#session) `| undefined`

The session to show, as the table lists.

### status

- **Type:** `'pending' | 'reauthorizing' | 'signedIn' | 'signedOut'`

The status, as the table lists.

## Store

`Store.Store` keeps an instance's session and a redirect's state, or a backend's sessions, as structured-clone storage such as IndexedDB or a Durable Object's storage does. [`Store.file`](Store.file.md) returns one for a CLI. [`Store.durableObject`](Store.durableObject.md), [`Store.memory`](Store.memory.md), [`Store.postgres`](Store.postgres.md), and [`Store.redis`](Store.redis.md) return one for a backend, and `Store.from` instantiates any other, such as a device's secure store.

### getItem

- **Type:** `(key: string) => Promise<unknown>`

Reads the value at `key`, or `undefined`.

### removeItem

- **Type:** `(key: string) => Promise<void>`

Deletes the value at `key`.

### setItem

- **Type:** `(key: string, value: unknown, options?: { expiresAt?: number }) => Promise<void>`

Writes `value` at `key`, without serializing it. A store that expires entries deletes it after `options.expiresAt`, in milliseconds. The [`backend`](plugins.backend.md) plugin sets it for a redirect in progress.

## TempoAccount

`TempoAccount.TempoAccount` is one of the user's Tempo Accounts: the Viem configurable account (TIP-1107) that `Account.fromConfig` from `viem/tempo` returns, with Tempo ID's fields. A client signs and sends with it as it is. It holds functions, so store the JSON of [`TempoAccount.serialize`](TempoAccount.serialize.md), and rebuild the account with [`TempoAccount.deserialize`](TempoAccount.deserialize.md).

### address

- **Type:** `` `0x${string}` ``

The account's address on the chain of the request. On a chain whose accounts are [configurable](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#addresses-by-chain), an account that Tempo ID created has the address that its configuration derives. On any other chain, or without a chain, its owner key's.

### config

- **Type:** `AccountConfig.Config | undefined`, from `ox/tempo`

The account's configuration on the chain of the request, as Viem holds it: its owners and their weights, salt, threshold, and version. `undefined` without a chain, or on a chain whose accounts are not configurable, where the account holds its address alone.

### keys

- **Type:** `readonly TempoAccount.Key[]`

The owner keys, each with its `address` and `type`, as for `owner`. A [configurable account](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md) can have several, such as a passkey and a Privy wallet.

#### keys[].credential (optional)

- **Type:** `{ id: string; publicKey: `0x${string}`; rpId: string }`

The passkey that holds a `webAuthn` key of the user's: its credential ID, its uncompressed P256 public key, whose address is the key's, and its relying party ID. On a chain with configurable accounts, the account signs with it as an owner.

### owner

- **Type:** `'privy' | 'secp256k1' | 'webAuthn' | (string & {})`

Who signs the account's key authorizations: a Privy wallet (`privy`) or, in development, a key (`secp256k1`), which Tempo ID signs with, or a passkey, which signs only on a Tempo ID page (`webAuthn`). An account with a cloud wallet among its owners names the cloud wallet. Treat another value as an owner that may refuse a key authorization, such as with `webauthn_required`.

### owners

- **Type:** `readonly LocalAccount[]`, from `viem`

The owners that sign for the account on this page: each passkey among `keys` with a `credential`, as `Account.fromWebAuthnP256` builds it. Empty off a configurable chain.

### realm

- **Type:** `{ id: string; name: string }`

The account's [realm](https://github.com/tempoxyz/id/blob/main/docs/realms.md) and its display name: `default`, or a realm that the app's settings name, such as `tempo-cash`. An app reaches only the accounts of its realms.

## Tokens

`Tokens.Tokens` is the app's tokens for Tempo APIs.

### accessToken

- **Type:** `string`

The access token for Tempo APIs: a Bearer token, or a [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) from an instance with `dpop`.

### expiresAt

- **Type:** `number`

When the access token expires, in milliseconds.

### idToken (optional)

- **Type:** `string`

The OIDC ID token, which names the user. A refresh may omit it.

### refreshToken (optional)

- **Type:** `string`

Exchanges for new tokens through [`Actions.refresh`](Actions.refresh.md). It rotates on every refresh.

## User

`User.User` is the signed-in user.

### email

- **Type:** `string`

The user's verified email address.

### id

- **Type:** `string`

The user's ID, such as `user_…`, and the `sub` of every token.
