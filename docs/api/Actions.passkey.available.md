# Actions.passkey.available

## Overview

Returns whether a passkey sign-in for the app runs on the current page, from `GET /v1/realms`. The page must be on the origin of one of the app's redirect URIs, and one of the app's realms must hold passkeys whose relying party covers the page and Tempo ID, as [Passkeys](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#app-pages) describes. The call needs no session.

The handle of [`Actions.passkey.prepare`](Actions.passkey.prepare.md) reads it as `available`, and requests options only where it returns `true`, so no options request fails with `passkey_not_permitted` or `invalid_origin`.

## Usage

```ts
import { Actions } from 'accounts/internal'

if (await Actions.passkey.available(config)) showPasskeyButton()
```

## Return type

`boolean`

`false` from a server that does not report it, and where the browser cannot read the response. A page that no first-party app's redirect URI names receives no CORS grant, so the call returns `false` there, as the options request would fail.

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): The instance's `clientId` is not a valid client ID.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
