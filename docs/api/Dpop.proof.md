# Dpop.proof

## Overview

Returns a [DPoP proof](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) for one request: a JWT that the key signs over the request's method and URL, without its query and fragment. A request with a `DPoP` access token passes the token, so the proof names its SHA-256 hash as `ath`. Each proof has a new `jti`, and Tempo ID accepts each proof once.

The token actions, [`Actions.oauth.userInfo`](Actions.oauth.userInfo.md), and [`Actions.fetch`](Actions.fetch.md) send their own proofs. An app calls `Dpop.proof` only for a request that it sends with another client.

## Usage

```ts
import { Dpop } from 'accounts'

const url = 'https://api.example.com/me'
const response = await fetch(url, {
  headers: {
    authorization: `DPoP ${tokens.accessToken}`,
    dpop: await Dpop.proof(dpop, {
      accessToken: tokens.accessToken,
      method: 'GET',
      url,
    }),
  },
})
```

## Return type

`string`

The proof, as a compact JWT with `typ: dpop+jwt`.

## Parameters

### dpop

- **Type:** [`Dpop.Dpop`](types.md#dpop)

The key that signs the proof.

### accessToken (optional)

- **Type:** `string`

The `DPoP` access token that the request sends. Leave it out for a request to the token endpoint.

```ts
await Dpop.proof(dpop, { accessToken, method: 'GET', url })
```

### method

- **Type:** `string`

The request's HTTP method, such as `POST`.

```ts
await Dpop.proof(dpop, {
  method: 'POST',
  url: 'https://id.tempo.xyz/oauth2/token',
})
```

### url

- **Type:** `string | URL`

The request's URL. The proof leaves out its query and fragment.

```ts
await Dpop.proof(dpop, {
  method: 'GET',
  url: new URL('/me', 'https://api.example.com'),
})
```
