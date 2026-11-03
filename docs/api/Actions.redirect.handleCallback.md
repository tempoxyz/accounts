# Actions.redirect.handleCallback

## Overview

Finishes a sign-in redirect. It checks the callback's `state` against `pending`, then redeems the code with the PKCE verifier, and the client secret for a backend. It returns the tokens and the key authorization that the user approved on Tempo ID's approval page.

## Usage

```ts
import { Actions } from 'accounts'

const authorization = await Actions.redirect.handleCallback(config, {
  pending: await unseal(c, 'oauth'),
  url: c.req.url,
})
```

## Return type

[`Authorization.Authorization`](types.md#authorization). For a `Pending.WithoutKey`, the authorization omits `accessKey` and `key`.

A `pending` typed as either returns either. Keep the stored type of `pending`, since one from a `createUrl` without `accessKey`, read back as `Pending.Pending`, is typed as an authorization.

## Parameters

### accessKey (optional)

- **Type:** `{ account?: Account.Account }`, a `Pick` of [`Permissions.WithAccount`](types.md#permissionswithaccount)

The `accessKey` that the app passed to `createUrl`, if any. The action reads only its `account`, the app's own access key as an `Account.Account` from `viem/tempo`, to rebuild that access key. Pass the same object that `createUrl` received.

```ts
const authorization = await Actions.redirect.handleCallback(config, {
  accessKey,
  pending,
  url: c.req.url,
})
```

### pending

- **Type:** [`Pending.Pending`](types.md#pending)

The state that `createUrl` returned to keep.

```ts
const authorization = await Actions.redirect.handleCallback(config, {
  pending: await unseal(c, 'oauth'),
  url: c.req.url,
})
```

### url

- **Type:** `string | URL`

The callback URL that Tempo ID redirected to.

```ts
const authorization = await Actions.redirect.handleCallback(config, {
  pending,
  url: 'https://app.example/auth/callback?code=…&state=…',
})
```

## Errors

### `Id.RequestError`

Thrown when the callback carries no valid code, or the token endpoint refuses the code.

#### Requests

- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request exceeded a rate limit. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### Without a `reason`

- **`invalid_request`:** The callback's `state` does not match `pending`. Start sign-in again.
- **The callback's `error`:** The callback carries no `code`, such as `access_denied` after a denial. An access key that Tempo ID refuses before sign-in returns its own `error`, such as `invalid_authorization_details` for an access key that breaks a [rule](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules), or `unauthorized_client` for a `challenge` without the `tempo-id:sign` scope. `message` is the `error_description`.
- **`invalid_grant`:** The code was already redeemed, expired, or carried no key authorization. Only the first redemption, within 10 minutes of the approval, returns the access key. Start sign-in again.
