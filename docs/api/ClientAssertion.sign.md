# ClientAssertion.sign

## Overview

Signs one [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions) (RFC 7523) with the app's private key, for an app with `private_key_jwt`. `iss` and `sub` are the client ID, `aud` is `audience`, and `jti` is a new random value. Tempo ID accepts each assertion once. Only the app's backend calls it.

## Usage

```ts
import { ClientAssertion } from 'accounts/internal'

const assertion = await ClientAssertion.sign({
  audience: 'https://id.tempo.xyz',
  clientId: 'DkqRtYbW…',
  privateKey: jwk,
})
```

## Return type

`Promise<string>`

The signed JWT, which the request sends as `client_assertion`.

## Parameters

### algorithm (optional)

- **Type:** `'ES256' | 'ES384' | 'ES512' | 'EdDSA' | 'RS256' | 'RS384' | 'RS512' | 'PS256' | 'PS384' | 'PS512'`
- **Default:** the JWK's `alg`, else the algorithm of its curve, else `RS256`

The signing algorithm.

```ts
await ClientAssertion.sign({
  algorithm: 'ES256',
  audience,
  clientId,
  privateKey,
})
```

### audience

- **Type:** `string`

Tempo ID's issuer, such as `https://id.tempo.xyz`, which every endpoint accepts as `aud`.

```ts
await ClientAssertion.sign({
  audience: 'https://id.tempo.xyz',
  clientId,
  privateKey,
})
```

### clientId

- **Type:** `string`

The app's client ID.

```ts
await ClientAssertion.sign({ audience, clientId: 'DkqRtYbW…', privateKey })
```

### expiresIn (optional)

- **Type:** `number`
- **Default:** `60`

The seconds until the assertion expires. Tempo ID refuses an assertion that expires more than 300 seconds after the request.

```ts
await ClientAssertion.sign({ audience, clientId, expiresIn: 120, privateKey })
```

### keyId (optional)

- **Type:** `string`
- **Default:** the JWK's `kid`

The `kid` of the registered public key, which the assertion's header names.

```ts
await ClientAssertion.sign({
  audience,
  clientId,
  keyId: 'backend-2026-10',
  privateKey,
})
```

### privateKey

- **Type:** `JWK | string`

The private key, as a JWK or a PKCS #8 PEM string.

```ts
await ClientAssertion.sign({
  audience,
  clientId,
  privateKey: process.env.TEMPO_ID_PRIVATE_KEY!,
})
```

## Errors

### `Error`

Thrown when the key does not import, or `algorithm` does not match the key.
