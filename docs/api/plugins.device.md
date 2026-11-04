# device

## Overview

The plugin of sign-in with the [device grant](https://github.com/tempoxyz/id/blob/main/docs/device-grant.md) ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), such as for a CLI, which adds `accounts.device.signIn`. The sign-in passes the user code to `onCode`, waits for the user to approve it on Tempo ID's device page in any browser, sets the instance's session, and returns it. No redirect URI or local server is involved.

The grant always requests an access key. The user approves its limits, so they may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling). Outside a browser, the instance holds the session only with a `store`, such as [`Store.file`](Store.file.md).

## Usage

```ts
import { Accounts, Store } from 'accounts'
import { device } from 'accounts/plugins'

const accounts = Accounts.create({
  accessKey: () => ({
    expiry: '7d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  clientId: 'cli:acme-deploy',
  plugins: [
    device({
      onCode: (code) =>
        console.log(
          `Open ${code.verificationUriComplete}, and confirm ${code.userCode}.`,
        ),
    }),
  ],
  store: Store.file('~/.config/acme-deploy/session.json'),
})

if (!(await accounts.session.get())) await accounts.device.signIn()
```

## Return type

`Plugin<'device', { signIn }>`

### device.signIn

- **Type:** `(parameters?: device.signIn.Parameters) => Promise<Session>`

Starts the device grant, and passes its code to `onCode`. It then polls until the user approves the code, sets the instance's [session](types.md#session), and returns it. The code expires after 10 minutes. The session holds no Tempo Account.

```ts
const { user } = await accounts.device.signIn()
```

## Parameters

### onCode

- **Type:** `(code: device.Code) => Promise<void> | void`

Shows the user code and the page to approve it on, such as in a terminal.

```ts
const accounts = Accounts.create({
  plugins: [device({ onCode: (code) => open(code.verificationUriComplete) })],
})
```

#### device.Code

The code that `onCode` receives holds these properties.

##### expiresIn

- **Type:** `number`

Seconds until the code expires.

##### userCode

- **Type:** `string`

The code that the user enters, such as `BCDF-GHJK`.

##### verificationUri

- **Type:** `string`

The device page.

##### verificationUriComplete

- **Type:** `string`

The device page with the code filled in.

### device.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, or a function that returns it. The grant always requests an access key, so a sign-in with `false`, or without `accessKey` on the call and the instance, throws.

```ts
const session = await accounts.device.signIn({
  accessKey: {
    expiry: '365d',
    limits: [{ limit: '1000', token: 'ousd' }],
  },
})
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope.

```ts
const session = await accounts.device.signIn({ challenge })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account. After the approval, an account that holds less opens Tempo ID's funding page in place of the approved screen, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.

```ts
const session = await accounts.device.signIn({ funding: { amount: '10' } })
```

## Errors

### `Accounts.KeyRequiredError`

Thrown before any request when neither the call nor the instance names an access key, or when the call passes `accessKey: false`.

### `Accounts.RequestError`

Thrown when Tempo ID refuses the code request, or while the call polls, with one of these `reason` values, or one of these `code` values from the token endpoint.

#### Device codes

- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): `clientId` names no enabled public first-party device app.
- `access_denied` (`code`): The user denied the code.
- `expired_token` (`code`): The code expired.
- `invalid_grant` (`code`): The code was already collected, or is unknown.

#### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

#### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.

#### Without a `reason`

- **`expired_token`:** The call polled until `expiresIn` passed. Request a new code.

### `Accounts.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.
