# TempoAccount.deserialize

## Overview

Rebuilds a Tempo Account from the JSON of [`TempoAccount.serialize`](TempoAccount.serialize.md), with no request. On a chain with configurable accounts, each passkey among `keys` with a `credential` signs as an owner, as in the account that `Actions.account.get` returns.

## Usage

```ts
import { TempoAccount } from 'accounts'

const account = TempoAccount.deserialize(
  JSON.parse(localStorage.getItem('account')!),
)
await client.token.transferSync({ account, amount, to, token })
```

## Return type

[`TempoAccount.TempoAccount`](types.md#tempoaccount)

## Parameters

### value

- **Type:** `TempoAccount.Serialized`

The JSON of `TempoAccount.serialize`.

### getFn (optional)

- **Type:** `Account.fromWebAuthnP256.Options['getFn']`, from `viem/tempo`

Runs the ceremony of a passkey owner in place of `navigator.credentials.get`.

```ts
const account = TempoAccount.deserialize(value, { getFn })
```

## Errors

### `TempoAccount.AddressMismatchError`

Thrown when a version 0 configuration does not derive `address`, such as for a value that changed after `serialize`. A later version keeps `address`, since its configuration no longer derives it. Read the account again with `Actions.account.get`.
