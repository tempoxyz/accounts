# Actions.oauth.introspect

## Overview

Checks whether a token is active, at `POST /oauth2/introspect` (RFC 7662). Verification against the [signing keys](Actions.oauth.jwks.md) accepts a token of an ended session until it expires, but introspection reports it inactive at once. The `clientSecret` authenticates the request, so only a backend calls it.

## Usage

```ts
import { Accounts } from 'accounts'
import { Actions } from 'accounts/internal'

const config = Accounts.from({
  clientId: env.CLIENT_ID,
  clientSecret: env.CLIENT_SECRET,
})

const result = await Actions.oauth.introspect(config, { token: accessToken })
if (!result.active) return c.json({ error: 'Sign in again.' }, 401)
```

## Return type

`{ active: false } | { active: true, … }`

An inactive token is expired, revoked, or never issued, and carries no other property. An active token carries these:

### active

- **Type:** `boolean`

Whether the token is active.

### clientId

- **Type:** `string | undefined`

The app that the token was issued to.

### expiresAt

- **Type:** `number | undefined`

When the token expires, in milliseconds.

### issuedAt

- **Type:** `number | undefined`

When the token was issued, in milliseconds.

### scope

- **Type:** `string | undefined`

The token's scopes, space-separated.

### userId

- **Type:** `string | undefined`

The user that the token names, the `sub` of every token.

## Parameters

### token

- **Type:** `string`

The access token or refresh token to check.

```ts
const result = await Actions.oauth.introspect(config, { token: accessToken })
```

### tokenTypeHint (optional)

- **Type:** `'access_token' | 'refresh_token'`

The kind of token, which speeds up the lookup.

```ts
const result = await Actions.oauth.introspect(config, {
  token: refreshToken,
  tokenTypeHint: 'refresh_token',
})
```

## Errors

### `Accounts.RequestError`

Thrown when the introspection endpoint refuses the request:

- **`invalid_client`:** The instance has no `clientSecret`, or Tempo ID refused it. This code carries no `reason`.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
