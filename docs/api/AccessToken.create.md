# AccessToken.create

## Overview

Creates a verifier of the [access tokens](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md) that Tempo ID issues to the apps of `clientIds`, or to the instance's own app by default. An API calls its `verify` for each Bearer token that it receives, with no call to Tempo ID after the first. The verifier checks each step of [Verification](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#verification):

1. The RS256 signature, over the keys of `GET /oauth2/jwks`, through jose's `createRemoteJWKSet`. The verifier keeps the keys for `maxAge`, then fetches them again, so a key that Tempo ID removed stops verifying. It also fetches them again for a token that names an unknown `kid`, at most once each 30 seconds after a successful fetch.
2. The `typ: at+jwt` header, so an ID token does not verify.
3. `iss` and `aud`, against `issuer`, and an `exp` that has not passed.
4. `client_id`, against `clientIds`, since `aud` is the same for every app.

Each fetch of the keys ends within `timeout`. Concurrent verifications share one fetch, except on Cloudflare Workers, where each request fetches the keys itself, as jose does there. Create one verifier for each Worker isolate or process, since it holds the keys.

> [!NOTE]
> Tempo ID receives more fetches during its own outage. The cooldown starts only after a successful fetch, so while the keys cannot be fetched, each verification that needs them fetches again.

## Usage

```ts
import { AccessToken, Accounts } from 'accounts'

const config = Accounts.from({ clientId: 'tempo-wallet' })
const verifier = AccessToken.create(config)

const token = await verifier.verify({ accessToken })
if (!AccessToken.includes(token, { address: transaction.from }))
  throw forbidden()
```

## Return type

`{ verify: (options: { accessToken: string }) => Promise<AccessToken.create.Token> }`

### verify

Verifies an access token, and returns its claims:

#### accessKeys

- **Type:** ``readonly { account: `0x${string}`; address: `0x${string}`; chainId: number }[]``

The user's live access keys that Tempo ID signed for the app, from [`access_keys`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#access-keys), with checksummed addresses. The access keys of the token's own session come first, then the others, newest first. A backend checks a signature's access key against them, as [Sign a message](../guides/viem.md#sign-a-message-as-the-tempo-account) shows.

#### accounts

- **Type:** ``readonly `0x${string}`[]``

The addresses of the user's Tempo Accounts in the app's realms, from [`tempo_accounts`](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#account-addresses), in no order. Empty for a third-party app.

#### clientId

- **Type:** `string`

The app that received the token.

#### expiresAt

- **Type:** `number`

When the token expires, in milliseconds.

#### scope

- **Type:** `readonly string[]`

The scopes that the app received.

#### userId

- **Type:** `string`

The user's ID, `user_` and a ULID.

## Parameters

### clientIds (optional)

- **Type:** `readonly string[]`
- **Default:** `[config.clientId]`

The client IDs of the apps whose tokens the API accepts. Every other app's token throws. Set it when the API accepts the tokens of several apps.

```ts
const verifier = AccessToken.create(config, {
  clientIds: ['tempo-wallet', 'tempo-cash'],
})
```

### issuer (optional)

- **Type:** `string`
- **Default:** The origin of the instance's `url`

Tempo ID's public origin, which every token names as `iss` and `aud`. Set it when the instance's `url` reaches Tempo ID at another address, such as an internal host. The verifier uses its origin, so a trailing slash does not matter.

```ts
const verifier = AccessToken.create(
  Accounts.from({ clientId, url: 'http://id.internal' }),
  {
    clientIds: ['tempo-wallet'],
    issuer: 'https://id.tempo.xyz',
  },
)
```

### maxAge (optional)

- **Type:** `number`
- **Default:** `600000` (10 minutes)

How long the verifier keeps the key set, in milliseconds. The first verification after it fetches the set again. If that fetch fails, `verify` throws its error instead of trusting the old keys.

```ts
const verifier = AccessToken.create(config, {
  clientIds: ['tempo-wallet'],
  maxAge: 60_000,
})
```

### timeout (optional)

- **Type:** `number`
- **Default:** `5000` (5 seconds)

How long a fetch of the key set may take, in milliseconds, as jose's `timeoutDuration`. A slower fetch throws `Accounts.RequestError` with status `0`, so a stalled Tempo ID fails the verifications that wait on it instead of holding them.

```ts
const verifier = AccessToken.create(config, {
  clientIds: ['tempo-wallet'],
  timeout: 2_000,
})
```

## Errors

### `AccessToken.InvalidError`

Thrown by `verify` for a token that does not verify, has expired, or names an app outside `clientIds`. Its `cause` holds the failed check, such as jose's `JWTExpired`. Respond with 401.

### `Accounts.RequestError`

Thrown by `verify`, with `status` `0` and `code` `temporarily_unavailable`, when the keys cannot be fetched or imported: a response other than 200, a request without a response, a fetch slower than `timeout`, or a key that does not import. Its `cause` holds jose's error, such as `JWKSTimeout`. Respond with 503, not 401, since the token can still be valid.
