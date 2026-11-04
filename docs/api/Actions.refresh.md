# Actions.refresh

## Overview

Exchanges a refresh token for new tokens at Tempo ID's token endpoint. Refresh tokens rotate, so store the new one in place of the old. A backend's `clientSecret` authenticates the request, and an instance with a [`dpop`](Accounts.from.md#dpop-optional) key sends a proof from it.

Two refreshes with one refresh token within 30 seconds return the same tokens, as [Concurrent refreshes](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#concurrent-refreshes) describes. If Tempo ID refuses the refresh with `invalid_grant`, the action sends it once more after one second, so a refresh that overlaps another one returns the other's tokens.

## Usage

```ts
import { Actions } from 'accounts'

const tokens = await Actions.refresh(config, {
  refreshToken: saved.refreshToken,
})
await store.set('session', { ...saved, ...tokens })
```

## Return type

[`Tokens.Tokens`](types.md#tokens)

The access token expires 300 seconds after Tempo ID issues it, as `expiresAt` records. A refresh may omit `idToken`.

## Parameters

### refreshToken

- **Type:** `string`

The latest refresh token.

```ts
const tokens = await Actions.refresh(config, {
  refreshToken: saved.refreshToken,
})
```

## Errors

### `Accounts.RequestError`

Thrown when the token endpoint refuses the request:

- **`invalid_grant`:** The refresh token was revoked, expired, or used more than 30 seconds earlier, also on the retry. Sign in again. This code carries no `reason`.
- **`invalid_dpop_proof`:** The refresh token is a [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md), and the instance holds no key or another key than the one that bound it. Refresh with the instance's `dpop` key. This code carries no `reason`.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request exceeded a rate limit. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
