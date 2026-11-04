# Actions.email.sendCode

## Overview

Emails the user a 6-digit sign-in code, with `POST /v1/auth/code`. [`Actions.email.signIn`](Actions.email.signIn.md) redeems the code within 10 minutes. The response is the same for every address, so it reveals no account.

## Usage

```ts
import { Actions } from 'accounts'

await Actions.email.sendCode(config, { email: 'user@example.com' })
```

## Return type

`void`

## Parameters

### email

- **Type:** `string`

The user's email address.

```ts
await Actions.email.sendCode(config, { email: 'user@example.com' })
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): A field is missing or malformed.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request or the email service exceeded a rate limit. Retry later.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The email service refused the code. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
