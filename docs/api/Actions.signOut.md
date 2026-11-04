# Actions.signOut

## Overview

Ends the user's Tempo ID session, which signs the user out of every app that relies on it. Refresh tokens stop working at once. Access tokens work until they expire, and access keys until their `expiry`, so delete the app's stored sign-in too.

## Usage

```ts
import { Actions } from 'accounts/internal'

await Actions.signOut(config)
```

## Return type

`void`

## Errors

### `Accounts.RequestError`

Thrown with [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected) when Tempo ID fails. Retry the request.
