# Actions.account.updateAccessKey

## Overview

Changes the limits, the scopes, or both of an access key of the user's Tempo Account, with the user's cloud wallet as the owner. Each limit replaces the amount of its token that the access key can still spend, and keeps the limit's period. A token that `limits` leaves out keeps its limit. `scopes` replace the access key's scopes.

An access key that the chain registered changes through `updateSpendingLimit`, `setAllowedCalls`, and `removeAllowedCalls`. An access key that the chain has not registered yet registers with the new permissions in the same transaction, so its earlier key authorization can never register it. The new permissions meet the [rules](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules) of every flow. [App revocation and changes](https://github.com/tempoxyz/id/blob/main/docs/access-keys.md#app-revocation-and-changes) describes the flow and its rules.

The action works in two ways:

| Caller                                             | Option           | Request                                                                           | Result                    |
| -------------------------------------------------- | ---------------- | --------------------------------------------------------------------------------- | ------------------------- |
| The page of a first-party app with `tempo-id:sign` | none             | `POST /v1/account/access-keys/update`, with the session cookie                    | The transaction's receipt |
| Any app, first-party or third-party                | `redirect: true` | None. The browser opens Tempo ID's approval page, `/access-keys/update`, at `url` | The approval page's `url` |

The first-party page changes any of the user's access keys, after the user approves the change on that page, within 10 minutes of a sign-in. The approval page changes only an access key that Tempo ID signed for the app itself, and shows the change for the user to approve, since the app's own page cannot be trusted to show it. The page then returns to the redirect URI with `state` and `transaction`, or with `error` and `error_description`.

## Usage

```ts
import { Actions } from 'accounts'

const receipt = await Actions.account.updateAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
  limits: [{ limit: 10_000_000n, token: '0x20c0…' }],
})
// receipt.status: 'success'
```

A third-party app sends the browser to the approval page:

```ts
import { Actions } from 'accounts'
import { Scopes } from 'viem/tempo'

const { url } = await Actions.account.updateAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
  redirect: true,
  scopes: [Scopes.tip20('0x20c0…').transfer()],
  state: 'af0ifjsldkj',
})
window.location.assign(url)
// https://app.example/callback?state=af0ifjsldkj&transaction=0x5c50…2060
```

## Return type

`TransactionReceipt | { url: string }`

Viem's receipt of the transaction that changed the access key. With `redirect: true`, the URL of the approval page, which the app opens.

## Parameters

### accessKey

- **Type:** `` `0x${string}` ``

The access key's address. Tempo ID must have signed the access key for the user, and, with `redirect`, for the app.

### account

- **Type:** `` `0x${string}` ``

The address of the user's Tempo Account that the access key acts for.

### chainId

- **Type:** `number`

The access key's chain ID.

### limits (optional)

- **Type:** `readonly { limit: bigint; token: `0x${string}` }[] | undefined`

The new remaining limits, one for each token that the access key's limits name, at most 32. `limit` is the amount of the TIP-20 `token` that the access key can still spend, in base units. Absent, every limit stays. An access key without a limit of a token spends it without a ceiling, so a change cannot add a limit.

```ts
await Actions.account.updateAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
  limits: [
    { limit: 5_000_000n, token: '0x20c0…' },
    { limit: 0n, token: '0x20c1…' },
  ],
})
```

### redirect (optional)

- **Type:** `boolean | undefined`
- **Default:** `false`

Whether Tempo ID's approval page shows the change. A third-party app sets it, and so does a first-party app without `tempo-id:sign`.

### redirectUri (optional)

- **Type:** `string | undefined`
- **Default:** the instance's `redirectUri`, or the root of the page's origin, such as `https://app.example/`

With `redirect`, one of the app's redirect URIs, which the approval page returns to.

### scopes (optional)

- **Type:** `Permissions['scopes']`

The calls that the access key can make after the change, as [`Accounts.create`](Accounts.create.md#permissions-optional)'s `permissions` name them. They replace the access key's scopes. Absent, the scopes stay.

```ts
await Actions.account.updateAccessKey(config, {
  accessKey: '0x9f10…',
  account: '0x7a3f…',
  chainId: 31318,
  scopes: [Scopes.tip20('0x20c0…').transferWithMemo()],
})
```

### state (optional)

- **Type:** `string | undefined`

With `redirect`, an opaque value that the approval page returns as it is.

## Errors

### `Accounts.RequestError`

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
