# Actions.account.get

## Overview

Returns the signed-in user's Tempo Account for the app as a Viem configurable account, with its `keys`, `owner`, and `realm`. The browser's Tempo ID session authorizes the requests, from a page on a registered origin of the app. With `accessToken`, the app's [access token](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#account-read) authorizes the read in place of the session, such as in a frame on another site. The action sends these requests:

1. `GET /v1/account` returns the account that the user [selected](https://github.com/tempoxyz/id/blob/main/docs/realms.md#selection) for the app, or else the oldest in the app's [realms](https://github.com/tempoxyz/id/blob/main/docs/realms.md).
2. `POST /v1/account`, for a user without an account, creates a Privy-owned one in the app's first realm, if that realm has a Privy app. The action sends it only when the read's `creatable` is `true`, so a realm that creates no account, such as `default`, costs one request.

The action builds the account with `Account.fromConfig` from `viem/tempo`. With `chain` or `chainId`, the address is the account's on that chain, which differs on a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#addresses-by-chain). On such a chain, the account holds its configuration, and a passkey of the user's among its owners signs for it. Elsewhere, it holds its address alone.

## Usage

```ts
import { Actions } from 'accounts'

const account = await Actions.account.get(config, { chainId: 31318 })
await client.sendTransaction({ account, calls })
// account.keys: [{ address: '0x…', credential: { id, publicKey, rpId }, type: 'webAuthn' }]
// account.realm: { id: 'default', name: 'Tempo' }
```

## Return type

[`TempoAccount.TempoAccount`](types.md#tempoaccount) `| undefined`

`undefined` when the user holds no account in the app's realms.

## Parameters

### accessToken (optional)

- **Type:** `string`

The app's access token, from a sign-in or a refresh. The read sends it in `Authorization`, as a Bearer token, or as a [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) with a proof from the instance's `dpop` key. The read then needs no session cookie. The creation of a first account for a user without one still needs it.

```ts
const authorization = await Actions.passkey.signIn(config)
const account = await Actions.account.get(config, {
  accessToken: authorization.accessToken,
  chainId: 31318,
})
```

### chain (optional)

- **Type:** `number | string`

The chain that the app acts on, by its name in `GET /v1/chains`, such as `testnet`, or its ID. Without it, the address is the owner key's. Tempo ID refuses an unknown chain with `invalid_field`.

```ts
const tempoAccount = await Actions.account.get(config, { chain: 'local' })
```

### chainId (optional)

- **Type:** `number`

The chain that the app acts on, by its ID, in place of `chain`. The action sends it as `chain`, so it reads no chain list. `chain` wins when both are present.

```ts
const tempoAccount = await Actions.account.get(config, { chainId: 31318 })
```

### getFn (optional)

- **Type:** `Account.fromWebAuthnP256.Options['getFn']`, from `viem/tempo`
- **Default:** `navigator.credentials.get`

Runs the ceremony of a passkey owner each time the account signs.

```ts
const account = await Actions.account.get(config, { chainId: 31318, getFn })
```

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses a request, with one of these `reason` values:

- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID, and the call passes no `accessToken`.
- [`invalid_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_token): `accessToken` is expired or revoked, its session ended, or it belongs to another app. Refresh the tokens, or sign in again.
- [`invalid_dpop_proof`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_dpop_proof): `accessToken` is a DPoP token, and the instance holds no key or another key than the one that bound it.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): The instance's `clientId` is not a valid client ID, `chain` names no listed chain, or `chainId` is not a listed chain's ID. The action throws the `chainId` refusal itself, with status `0`, before the account request.
- [`origin_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#origin_required): The request carries no `Origin`, such as from outside a browser, so it does not prove the app of `clientId`. Call the action from a page at a redirect URI of the app.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account reads, or Privy rate limited the request. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): Privy failed or timed out. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
