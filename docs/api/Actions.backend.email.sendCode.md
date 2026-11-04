# Actions.backend.email.sendCode

## Overview

Emails the user a 6-digit sign-in code from the app's backend, with `POST /v1/auth/code` and the app's client secret or [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions). [`Actions.backend.email.signIn`](Actions.backend.email.signIn.md) redeems the code within 10 minutes. The response is the same for every address, so it reveals no account. The app needs [backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md#eligibility).

## Usage

```ts
import { Accounts } from 'accounts'
import { Actions } from 'accounts/internal'

const config = Accounts.from({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
})

await Actions.backend.email.sendCode(config, {
  email: 'user@example.com',
  userIp: '203.0.113.7',
})
```

## Return type

`void`

## Parameters

### email

- **Type:** `string`

The user's email address.

```ts
await Actions.backend.email.sendCode(config, { email: 'user@example.com' })
```

### userIp (optional)

- **Type:** `string`

The end user's IP address, as the backend received the user's request. Rate limits count the request by it, in place of the backend's address. Leave it out only when the backend has no user address.

```ts
await Actions.backend.email.sendCode(config, {
  email,
  userIp: c.req.header('cf-connecting-ip'),
})
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

- [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client): The instance has no `clientSecret` or `clientAssertion`, the app is unknown or disabled, or its secret or keys refuse the request. Without either, the action throws before any request, with `status` 0.
- [`backend_sign_in_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#backend_sign_in_not_permitted): The app has no client secret or keys, or does not hold backend sign-in.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): A field is missing or malformed, such as `userIp`.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request or the email service exceeded a rate limit. Retry later.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The email service refused the code. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
