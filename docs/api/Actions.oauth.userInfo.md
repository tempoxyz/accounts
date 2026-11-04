# Actions.oauth.userInfo

## Overview

Returns the user that an access token names, from Tempo ID's UserInfo endpoint (OIDC Core §5.3). Access tokens carry no email, so an API that needs it calls this once per user. An instance with a [`dpop`](Accounts.from.md#dpop-optional) key sends a DPoP token, one whose `cnf` names a key, with the `DPoP` scheme and a proof over it. It sends a Bearer token as a Bearer token.

## Usage

```ts
import { Actions } from 'accounts/internal'

const user = await Actions.oauth.userInfo(config, { accessToken })
// { email: 'user@example.com', id: 'user_…' }
```

## Return type

[`User.User`](types.md#user)

## Parameters

### accessToken

- **Type:** `string`

The access token, from any sign-in or refresh.

```ts
const user = await Actions.oauth.userInfo(config, {
  accessToken: authorization.accessToken,
})
```

## Errors

### `Accounts.RequestError`

Thrown when the UserInfo endpoint refuses the request:

- **`invalid_token`:** The access token is invalid or expired, or any other 401 response. Refresh with [`Actions.refresh`](Actions.refresh.md), or sign in again. This code carries no `reason`.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
