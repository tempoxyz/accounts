# Id.RequestError

## Overview

The error that every action and every instance member throws when Tempo ID refuses a request, with the fields of the OAuth error response. A sign-in that fails after Tempo ID signed the user in empties the instance's session, and its error has `signedIn: true`.

## Usage

```ts
import { Id } from 'accounts'

try {
  await tempoId.authorize()
} catch (error) {
  if (
    error instanceof Id.RequestError &&
    error.reason === 'limit_exceeds_maximum'
  )
    showMaximum(error.meta?.maximum)
}
```

## Properties

### code

- **Type:** `string`

The OAuth error code, such as `invalid_authorization_details`, or `server_error` for a refusal without a JSON body.

### field

- **Type:** `string | undefined`

The request field at fault, as a dotted path, such as `key_authorization.limits.0.limit`.

### message

- **Type:** `string`

The fault and its fix, from `error_description`. Branch on `reason` instead, since the wording may change.

### meta

- **Type:** `Readonly<Record<string, number | string>> | undefined`

The values that the refusal compared, such as `limit` and `maximum`. Base units are decimal strings.

### name

- **Type:** `'Id.RequestError'`

### reason

- **Type:** `Id.RequestError.Reason | undefined`

A stable name for the refusal, to branch on, as [Errors](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reasons) lists. Errors from the OAuth endpoints at `/oauth2/*` carry none.

### signedIn

- **Type:** `boolean`

Whether a sign-in's code or passkey verified before Tempo ID refused the authorization, so the user is signed in. The email and passkey sign-ins set it, and so does the read of the account after a passkey sign-in. An instance empties its session for such an error.

### status

- **Type:** `number`

The HTTP status of Tempo ID's response, or 0 without a response.

### uri

- **Type:** `string | undefined`

The page that explains the error, from `error_uri`.
