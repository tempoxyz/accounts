# Actions.funding.complete

## Overview

Returns the result of the deposit page that [`Actions.funding.open`](Actions.funding.open.md) opened with `mode: 'redirect'`, on the redirect URI's page that the browser returns to. It reads the `deposit_status` and `deposit_amount` parameters that `GET /i/funding/return` appends to the redirect URI. Without `url`, it reads the page's URL, and removes both parameters from the address bar.

The result is a hint. Any page can link to the redirect URI with the same parameters, so read the account's balance before relying on a deposit.

## Usage

```ts
import { Actions } from 'accounts'

const result = Actions.funding.complete(config)
if (result?.status === 'received') await refreshBalance()
```

## Return type

`{ amount?: string; status: 'continued' | 'received' } | undefined`, as [`Actions.funding.open`](Actions.funding.open.md#return-type) describes. `undefined` for a URL without `deposit_status`, and for a URL that is not the redirect URI.

## Parameters

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the origin of `url` with `/`

The redirect URI that `open` passed to the deposit page. A URL at another path or origin, or without the redirect URI's own query parameters in their order, returns `undefined`.

```ts
const result = Actions.funding.complete(config, {
  redirectUri: 'https://app.example/wallet',
})
```

### url (optional)

- **Type:** `string | URL`
- **Default:** The page's URL

The URL that the deposit page returned to. A call with `url` leaves the address bar as it is.

```ts
const result = Actions.funding.complete(config, { url: request.url })
```
