# Actions.redirect.createUrl

## Overview

Returns the sign-in URL and the `pending` state to keep until the callback, for a backend or a native app. A sign-in with `accessKey` requests an access key, and always shows Tempo ID's approval page, even for an app that skips consent. [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md) redeems the code that the callback carries.

An instance with a client secret, a client assertion, or [`par`](Id.from.md#par-optional) first pushes the request to `POST /oauth2/par`, as [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md) describes. The URL then holds only `client_id` and `request_uri`, so no one between the app and Tempo ID can change the access key's limits.

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
const { pending, url } = await Actions.redirect.createUrl(config, {
  accessKey,
  redirectUri: 'https://app.example/auth/callback',
})
await seal(c, 'oauth', pending)
return c.redirect(url)
```

## Return type

### pending

- **Type:** [`Pending.Pending`](types.md#pending)

The PKCE verifier, the state, the redirect URI, and the new access key's material, or `key: false` for a call without `accessKey`. A backend keeps it in a sealed cookie, and a native app in memory while the system browser is open. Keep it as secret as a session.

### url

- **Type:** `string`

Tempo ID's authorization endpoint, `/oauth2/authorize`, with the authorization request in its query, or with only `client_id` and `request_uri` for a pushed request. It redirects to the sign-in page or the approval page. A pushed request's URL expires after 60 seconds, so send the browser to it at once.

## Parameters

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`. Without it, the sign-in authorizes no access key, and takes no `challenge`. The action sends the fields as given. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). The access key names its `limits` and `scopes`, which the user approves, so they may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the one that the user selects at sign-in, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere, whose material `pending` keeps. With `account`, pass the same object to `handleCallback` too. Without `account`, `publicKey` and `type` name an access key whose private key the page does not hold, such as one on the app's server, and `type` defaults to `secp256k1`. The result's `accessKey` then rejects each signature with `AccessKey.AccessKeyRequiredError`.

```ts
const { pending, url } = await Actions.redirect.createUrl(config, {
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
const { pending, url } = await Actions.redirect.createUrl(config, {
  accessKey,
  challenge,
})
```

### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes. After the approval, an account that holds less opens Tempo ID's funding page, which continues to the callback. Without it, no funding page opens.

```ts
const { pending, url } = await Actions.redirect.createUrl(config, {
  funding: { amount: '10', currency: 'USD' },
})
```

### prompt (optional)

- **Type:** `login`

Requests a new sign-in of a user whom the browser holds signed in. Tempo ID shows its sign-in page with the email field filled, and the field stays editable. Without it, Tempo ID reuses the browser's session.

```ts
const { pending, url } = await Actions.redirect.createUrl(config, {
  prompt: 'login',
})
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin

Where Tempo ID redirects back to, which must be one of the app's registered redirect URIs.

```ts
const { pending, url } = await Actions.redirect.createUrl(config, {
  redirectUri: 'https://app.example/auth/callback',
})
```

## Errors

### `Id.ChallengeWithoutKeyError`

Thrown when the call receives `challenge` without `accessKey`. Remove `challenge`, or request an access key.

### `Id.RequestError`

Thrown when `POST /oauth2/par` refuses a pushed request, with its `reason`: [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client), [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected), [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`body_too_large`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#body_too_large), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), or a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules)'s reason.
