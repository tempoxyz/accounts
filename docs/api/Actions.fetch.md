# Actions.fetch

## Overview

Sends a request with an access token, such as to the app's API. A [DPoP token](https://github.com/tempoxyz/id/blob/main/docs/dpop.md) from an instance with a [`dpop`](Id.from.md#dpop-optional) key goes with `Authorization: DPoP <token>` and a new proof for the request's method and URL. Any other token goes as `Authorization: Bearer <token>`. The request goes through the instance's `fetch`.

An API that receives DPoP tokens accepts the `DPoP` scheme, and checks the proof as [Resource requests](https://github.com/tempoxyz/id/blob/main/docs/dpop.md#resource-requests) describes.

## Usage

```ts
import { Actions } from 'accounts'

const response = await Actions.fetch(config, {
  accessToken: tokens.accessToken,
  init: { body: JSON.stringify({ amount: '10' }), method: 'POST' },
  url: 'https://api.example.com/transfers',
})
```

## Return type

`Response`

The API's response, as `fetch` returns it.

## Parameters

### accessToken

- **Type:** `string`

The access token, from any sign-in or refresh.

```ts
await Actions.fetch(config, { accessToken: tokens.accessToken, url })
```

### init (optional)

- **Type:** `RequestInit`

The request's other options, such as `method`, `headers`, and `body`. The action replaces its `Authorization` and `DPoP` headers. The method defaults to `GET`.

```ts
await Actions.fetch(config, { accessToken, init: { method: 'DELETE' }, url })
```

### url

- **Type:** `string | URL`

The request's URL. In a browser, a relative URL such as `/api/me` resolves against the page's URL, as `fetch` resolves it.

```ts
await Actions.fetch(config, { accessToken, url: 'https://api.example.com/me' })
```
