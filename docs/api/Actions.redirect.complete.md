# Actions.redirect.complete

## Overview

Finishes an [`Actions.redirect.start`](Actions.redirect.start.md) when the page loads with Tempo ID's callback. It redeems the code once, however often the page calls it, and removes the callback's `code`, `state`, and `error` parameters from the address bar. With the default storage, it sends the code exchange before IndexedDB returns the redirect's state, from the verifier that `start` kept in the tab's `sessionStorage`. Any other page keeps its own `state` and `error` parameters, unless it has a `code`.

## Usage

```ts
import { Actions } from 'accounts'

const authorization =
  (await Actions.redirect.complete(config)) ??
  (await Actions.authorize(config, { accessKey }))
```

## Return type

`Authorization.Authorization | handleCallback.WithoutKey | undefined`, with [`Authorization`](types.md#authorization). The authorization holds `accessKey` and `key` when `redirect.start` received `accessKey`, and omits them otherwise. Check for `key` before reading it.

`undefined` when the page is not the callback of a redirect that this page started.

## Parameters

### accessKey (optional)

- **Type:** `{ account?: Account.Account; publicKey?: Hex; type?: 'p256' | 'secp256k1' }`, a `Pick` of [`Permissions.WithAccount`](types.md#permissionswithaccount)

The `accessKey` that the app passed to `redirect.start`, if any. The action reads only its `account`, or its `publicKey` and `type`, to rebuild that access key. Pass the same object that `redirect.start` received.

```ts
const authorization = await Actions.redirect.complete(config, { accessKey })
```

## Errors

### `Id.RequestError`

Thrown for a callback with a `code`, with the [errors of `Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md#errors).

Thrown for a callback that denies the redirect, such as when the user denies the approval page. Its `code` is the callback's `error`, such as `access_denied`, its `message` is the `error_description`, and its `status` is 0. The call removes the stored state, so a later [`Actions.authorize`](Actions.authorize.md) does not override the denial.
