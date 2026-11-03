# TempoAccount.serialize

## Overview

Returns the JSON form of a Tempo Account, which [`TempoAccount.deserialize`](TempoAccount.deserialize.md) rebuilds with no request. The JSON holds public values only: addresses, the configuration, the realm, and the public keys of passkeys.

## Usage

```ts
import { Actions, TempoAccount } from 'accounts'

const account = await Actions.account.get(config, { chainId: 31318 })
localStorage.setItem(
  'account',
  JSON.stringify(TempoAccount.serialize(account!)),
)
```

## Return type

`TempoAccount.Serialized`

| Field               | Type                                 | Value                                                                         |
| ------------------- | ------------------------------------ | ----------------------------------------------------------------------------- |
| `address`           | `` `0x${string}` ``                  | The account's address.                                                        |
| `config` (optional) | `AccountConfig.Rpc`, from `ox/tempo` | The account's configuration. Absent where the account is not configurable.    |
| `keys`              | `readonly TempoAccount.Key[]`        | The owner keys, as for [`keys`](types.md#keys).                               |
| `owner`             | `string`                             | Who signs the account's key authorizations, as for [`owner`](types.md#owner). |
| `realm`             | `{ id: string; name: string }`       | The account's realm, as for [`realm`](types.md#realm).                        |

## Parameters

### account

- **Type:** [`TempoAccount.TempoAccount`](types.md#tempoaccount)

The account, as `Actions.account.get` or `Actions.account.upgrade` returns it.
