# Actions.redirect.start

## Overview

Sends the browser to Tempo ID's pages to sign in, and keeps the redirect's state and the new access key in the instance's `store`. With the default storage, it also keeps the `state`, the redirect URI, and the PKCE verifier in the tab's `sessionStorage`, without the access key, so the callback page redeems the code at once. A sign-in with `accessKey` requests an access key, and always shows the approval page. [`Actions.redirect.complete`](Actions.redirect.complete.md) finishes it when the browser returns.

## Usage

```ts
import { Actions } from 'accounts'
import { Expiry, Scopes } from 'viem/tempo'

// An access key that may transfer up to 100 OUSD for 30 days.
const accessKey = {
  expiry: Expiry.days(30),
  limits: [{ limit: 100_000_000n, token: ousd }],
  scopes: [Scopes.tip20(ousd).transfer()],
}
await Actions.redirect.start(config, { accessKey })
```

Without `accessKey`, the sign-in authorizes no access key:

```ts
await Actions.redirect.start(config)
```

## Return type

`void`. The browser leaves the page.

## Parameters

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`. Without it, the sign-in authorizes no access key, and takes no `challenge`. The action sends the fields as given. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). The access key names its `limits` and `scopes`, which the user approves, so they may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the one that the user selects at sign-in, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere, whose material the instance's `store` keeps. With `account`, pass the same object to `redirect.complete` too. Without `account`, `publicKey` and `type` name an access key whose private key the page does not hold, such as one on the app's server, and `type` defaults to `secp256k1`. The result's `accessKey` then rejects each signature with `AccessKey.AccessKeyRequiredError`.

```ts
await Actions.redirect.start(config, {
  accessKey: {
    account,
    expiry: Expiry.days(30),
    limits: [{ limit: 50_000_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope and `accessKey`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
await Actions.redirect.start(config, { accessKey, challenge })
```

### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes. After the approval, an account that holds less opens Tempo ID's funding page, which continues to the callback. Without it, no funding page opens.

```ts
await Actions.redirect.start(config, {
  funding: { amount: '10', currency: 'USD' },
})
```

## Errors

### `Id.ChallengeWithoutKeyError`

Thrown when the call receives `challenge` without `accessKey`. Remove `challenge`, or request an access key.

### `Id.RequestError`

Thrown before the navigation when `par` is `true` and `POST /oauth2/par` refuses a pushed request, with its `reason`: [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client), [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected), [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`body_too_large`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#body_too_large), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), or a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules)'s reason.
