# LogoutToken.create

## Overview

Creates a verifier of the [logout tokens](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#back-channel-logout) that Tempo ID posts to the back-channel logout URI of the apps of `clientIds`, or of the instance's own app by default. The app's backend calls its `verify` for each `logout_token` that it receives, then ends its own session that the token's `sessionId` names. The verifier checks each rule of Back-Channel Logout §2.6:

1. The RS256 signature, over the keys of `GET /oauth2/jwks`, through jose's `createRemoteJWKSet`, as [`AccessToken.create`](AccessToken.create.md) fetches and keeps them.
2. The `typ: logout+jwt` header, so an ID token or an access token does not verify.
3. `iss`, against `issuer`, `aud`, against `clientIds`, and an `exp` that has not passed.
4. The logout event in `events`, a `sid`, a `sub`, a `jti`, and no `nonce`.

Each fetch of the keys ends within `timeout`. Create one verifier for each Worker isolate or process, since it holds the keys.

## Usage

```ts
import { LogoutToken, Id } from 'accounts'

const verifier = LogoutToken.create(Id.from({ clientId: 'tempo-wallet' }))

export async function backchannelLogout(request: Request) {
  const form = await request.formData()
  const token = await verifier
    .verify({ logoutToken: String(form.get('logout_token')) })
    .catch((error: unknown) => error)
  // An invalid token is refused. Unavailable keys respond with 503, so Tempo ID retries once.
  if (token instanceof LogoutToken.InvalidError)
    return new Response(null, { status: 400 })
  if (token instanceof Error) return new Response(null, { status: 503 })

  await sessions.endTempoIdSession(token.sessionId)
  return new Response(null, { status: 204 })
}
```

## Return type

`{ verify: (options: { logoutToken: string }) => Promise<LogoutToken.create.Token> }`

### verify

Verifies a logout token, and returns its claims:

#### clientId

- **Type:** `string`

The app that the token names in `aud`.

#### id

- **Type:** `string`

The token's `jti`, unique to each token. A backend that refuses a replayed token stores it until the token expires, 2 minutes after its issue.

#### sessionId

- **Type:** `string`

The ended session, which the app's ID tokens of that session name as `sid`.

#### userId

- **Type:** `string`

The user's ID, `user_` and a ULID, which the app's ID tokens name as `sub`.

## Parameters

### clientIds (optional)

- **Type:** `readonly string[]`
- **Default:** `[config.clientId]`

The client IDs of the apps whose logout tokens the backend accepts. Every other app's token throws.

```ts
const verifier = LogoutToken.create(config, {
  clientIds: ['tempo-wallet', 'tempo-cash'],
})
```

### issuer (optional)

- **Type:** `string`
- **Default:** The origin of the instance's `url`

Tempo ID's public origin, which every token names as `iss`. Set it when the instance's `url` reaches Tempo ID at another address, such as an internal host.

```ts
const verifier = LogoutToken.create(
  Id.from({ clientId, url: 'http://id.internal' }),
  { issuer: 'https://id.tempo.xyz' },
)
```

### maxAge (optional)

- **Type:** `number`
- **Default:** `600000` (10 minutes)

How long the verifier keeps the key set, in milliseconds. The first verification after it fetches the set again.

```ts
const verifier = LogoutToken.create(config, { maxAge: 60_000 })
```

### timeout (optional)

- **Type:** `number`
- **Default:** `5000` (5 seconds)

How long a fetch of the key set may take, in milliseconds. A slower fetch throws `Id.RequestError` with status `0`.

```ts
const verifier = LogoutToken.create(config, { timeout: 2_000 })
```

## Errors

### `LogoutToken.InvalidError`

Thrown by `verify` for a token that does not verify, has expired, is no logout token, or names an app outside `clientIds`. Its `cause` holds the failed check, such as jose's `JWTExpired`. Respond with 400, as Back-Channel Logout §2.8 requires.

### `Id.RequestError`

Thrown by `verify`, with `status` `0` and `code` `temporarily_unavailable`, when the keys cannot be fetched or imported. Respond with 503, so Tempo ID retries the post once.
