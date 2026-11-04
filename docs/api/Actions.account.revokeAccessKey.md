# Actions.account.revokeAccessKey

## Overview

Revokes an access key of the user's Tempo Account on its chain, with the user's cloud wallet as the owner, and returns the receipt of the revoking transaction, which the response holds.

Tempo ID sends the transaction from the account, since the chain refuses keychain changes from an access key. An access key that the chain has not registered yet registers without limits or calls and revokes in the same transaction, so its key authorization can never register it later. [App revocation and changes](https://github.com/tempoxyz/id/blob/main/docs/access-keys.md#app-revocation-and-changes) describes the flow and its rules.

The action works in two ways:

| Caller                                             | Option        | Request                                                        | Access keys                                    |
| -------------------------------------------------- | ------------- | -------------------------------------------------------------- | ---------------------------------------------- |
| Any app, first-party or third-party                | `accessToken` | `POST /v1/access-keys/revoke`, with the access token           | Only the ones that Tempo ID signed for the app |
| The page of a first-party app with `tempo-id:sign` | none          | `POST /v1/account/access-keys/revoke`, with the session cookie | Any of the user's                              |

With `accessToken`, the revocation needs no approval and no recent sign-in, since it only removes authority. The request sends no cookie (`credentials: 'omit'`), since the route's CORS response admits any origin without credentials. Without it, call the action from the page of a first-party app with the `tempo-id:sign` scope, after the user approves the revocation there, within 10 minutes of a sign-in. A passkey owner of the account revokes in the browser, or on the permissions page, without this action.

## Usage

```ts
import { Actions } from 'accounts'

const receipt = await Actions.account.revokeAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
})
// receipt.status: 'success'
```

A third-party app revokes its own access key with its access token:

```ts
import { Actions } from 'accounts'

const receipt = await Actions.account.revokeAccessKey(config, {
  accessKey: session.key.keyAuthorization.keyId,
  accessToken: session.tokens.accessToken,
  account: session.key.account,
  chainId: 4217,
})
```

## Return type

`TransactionReceipt | null`

Viem's receipt of the revoking transaction, or `null` when the chain held the access key revoked already.

## Parameters

### accessKey

- **Type:** `` `0x${string}` ``

The access key's address. Tempo ID must have signed the access key for the user.

```ts
await Actions.account.revokeAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
})
```

### accessToken (optional)

- **Type:** `string | undefined`

The app's access token, from a sign-in or a refresh, which authenticates the revocation of the app's own access key without the session cookie. The request sends it as a Bearer token, or as a DPoP token with a proof from the instance's `dpop` key.

```ts
await Actions.account.revokeAccessKey(config, {
  accessKey: '0x9f10…',
  accessToken: tokens.accessToken,
  account: '0x7a3f…',
  chainId: 31318,
})
```

### account

- **Type:** `` `0x${string}` ``

The address of the user's Tempo Account that the access key acts for.

```ts
await Actions.account.revokeAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
})
```

### chainId

- **Type:** `number`

The access key's chain ID.

```ts
await Actions.account.revokeAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 4217,
})
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

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
