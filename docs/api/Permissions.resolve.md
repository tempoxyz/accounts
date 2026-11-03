# Permissions.resolve

## Overview

Returns permissions as the key authorization request sends them: Unix seconds, base units, token addresses, and scopes. Each sign-in and `authorize` calls it, so an app calls it only to read what a request will send, such as to show the access key before a sign-in.

- A [duration](types.md#permissions) expiry, such as `'1d'`, counts from the call. `expiry: false` becomes 0, for an access key that never expires. An absent expiry stays absent, and Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry).
- A token symbol, such as `'ousd'`, becomes the token's address on the chain.
- A decimal limit, such as `'10'`, becomes base units with the token's decimals.
- Without `scopes`, the scopes come from `limits`: `transfer` and `transferWithMemo` on each token, `approve` to each limit's `spenders`, and `open` and `topUp` on the TIP-1034 channel reserve, which MPP sessions pay through. Named `scopes` replace them. `scopes: 'any'` resolves to no scopes, for an access key that makes any call.

## Usage

```ts
import { Permissions } from 'accounts'
import { tempo } from 'viem/tempo/chains'

const resolved = Permissions.resolve(
  { expiry: '1d', limits: [{ limit: '10', token: 'ousd' }] },
  { chainId: tempo.id },
)
```

## Return type

`Permissions.Resolved`

### chainId

- **Type:** `number`

The access key's chain: the chain that the permissions name, else `chainId`.

### expiry (optional)

- **Type:** `number`

When the access key expires, in Unix seconds, or 0 for an access key that never expires (`expiry: false`). Absent when the permissions name no expiry, since Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry).

### limits (optional)

- **Type:** `KeyAuthorization.KeyAuthorization['limits']`, from `ox/tempo`

How much of each token the access key may spend, in base units, with each `period` in seconds.

### scopes (optional)

- **Type:** `KeyAuthorization.KeyAuthorization['scopes']`, from `ox/tempo`

The calls the access key may make. Absent for an access key that makes any call: for `scopes: 'any'`, or for permissions without `scopes` and `limits`.

## Parameters

### permissions

- **Type:** [`Permissions`](types.md#permissions)

The permissions to resolve.

### chainId

- **Type:** `number`

The chain of permissions that name none, such as the instance's `chainId`.

```ts
const resolved = Permissions.resolve(permissions, { chainId: tempo.id })
```

## Errors

### `Permissions.DecimalsUnknownError`

A decimal `limit` names a token that the chain does not list. Pass the limit in base units as a bigint.

### `Permissions.InvalidDurationError`

A duration is not a whole number and one of the units `s`, `m`, `h`, `d`, or `w`.

### `Permissions.LimitPrecisionError`

A decimal `limit` has more fractional digits than the token's decimals, such as `'0.0000005'` for a 6-decimal token. Round the limit down.

### `Permissions.TokenUnknownError`

A token symbol names no token that the chain lists. Pass the token's address.
