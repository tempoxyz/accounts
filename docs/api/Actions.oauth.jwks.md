# Actions.oauth.jwks

## Overview

Returns Tempo ID's JSON Web Key Set from `/oauth2/jwks`, whose RS256 keys verify every Tempo ID token. Pass the URL to a JWT library that caches the set and fetches it again for an unknown `kid`, such as jose's `createRemoteJWKSet`. An API that caches the set itself fetches it again for an unknown `kid` too, at most once in a cooldown, since a [key rotation](https://github.com/tempoxyz/id/blob/main/docs/cli.md#signing-keys) signs new tokens with a new key.

## Usage

```ts
import { Actions } from 'accounts/internal'
import { createLocalJWKSet, errors, jwtVerify } from 'jose'

// Tempo ID's origin is both the issuer and the audience of every access token.
const options = { audience: config.url, issuer: config.url }
let keys = createLocalJWKSet(await Actions.oauth.jwks(config))
let fetchedAt = Date.now()
let refetch: Promise<void> | undefined

async function verify(accessToken: string) {
  try {
    return await jwtVerify(accessToken, keys, options)
  } catch (error) {
    if (!(error instanceof errors.JWKSNoMatchingKey)) throw error
    // Concurrent failures share one fetch. The cooldown bounds fetches for forged `kid` values.
    if (!refetch) {
      if (Date.now() - fetchedAt < 30_000) throw error
      fetchedAt = Date.now()
      refetch = Actions.oauth
        .jwks(config)
        .then((set) => {
          keys = createLocalJWKSet(set)
        })
        .finally(() => {
          refetch = undefined
        })
    }
    await refetch
    return await jwtVerify(accessToken, keys, options)
  }
}

const { payload } = await verify(accessToken)
// Every app's token carries the same audience, so the API also allows each app by its client ID.
if (!allowedClientIds.includes(String(payload.client_id))) throw forbidden()
```

[Access tokens](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#verification) describes each check.

## Return type

`{ keys: JsonWebKey[] }`

The key set, in RFC 7517's format, which JWT libraries read as is.

## Errors

### `Accounts.RequestError`

Thrown with [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected) when Tempo ID fails. Retry the request.
