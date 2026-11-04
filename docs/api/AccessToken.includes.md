# AccessToken.includes

## Overview

Returns whether an address is one of a verified access token's Tempo Accounts, in any letter case. A value that is no address, such as a malformed one from a request, returns `false`. An API checks an address that it receives, such as a transaction's sender, before it acts for the user.

## Usage

```ts
import { AccessToken } from 'accounts/internal'

const token = await verifier.verify({ accessToken })
if (!AccessToken.includes(token, { address: transaction.from }))
  throw forbidden()
```

## Return type

`boolean`

## Parameters

### token

- **Type:** `{ accounts: readonly `0x${string}`[] }`

A token that [`AccessToken.create`](AccessToken.create.md)'s `verify` returned.

### address

- **Type:** `` `0x${string}` ``

The address to look for.

```ts
AccessToken.includes(token, { address: '0x…' })
```
