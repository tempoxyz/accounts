# Actions.realm.list

## Overview

Lists the [realms](https://github.com/tempoxyz/id/blob/main/docs/realms.md) that the app reaches, in the order of its settings. The first holds a user's first account, and an app without settings reaches the `default` realm alone. The call needs no session.

## Usage

```ts
import { Actions } from 'accounts'

const realms = await Actions.realm.list(config)
// [{ id: 'default', name: 'Tempo' }]
```

## Return type

`readonly { id: string; name: string }[]`

### id

- **Type:** `string`

The realm ID, such as `default` or `tempo-cash`, which each account's [`realm`](types.md#realm) names.

### name

- **Type:** `string`

The realm's display name, such as `Tempo Cash`.

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): The instance's `clientId` is not a valid client ID.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
