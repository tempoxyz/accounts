# Actions.device.authorize

## Overview

Starts the device grant ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)) for a CLI, as the device app that `clientId` names, such as `tempo-cli`. The user approves `userCode` and the access key's limits at `verificationUri`, from any browser. The sign-in and the device page use that app's realms. The action sends these requests:

1. `POST /device/code` requests the code.
2. `POST /oauth2/token`, which `wait` polls, returns the authorization once the user approves.

## Usage

```ts
import { Actions, Id } from 'accounts'
import { Expiry, Scopes } from 'viem/tempo'

const config = Id.from({ clientId: 'tempo-cli' })
// An access key that may transfer up to 100 OUSD for 30 days.
const accessKey = {
  expiry: Expiry.days(30),
  limits: [{ limit: 100_000_000n, token: ousd }],
  scopes: [Scopes.tip20(ousd).transfer()],
}
const device = await Actions.device.authorize(config, { accessKey })
console.log(
  `Open ${device.verificationUriComplete} and confirm ${device.userCode}.`,
)
const authorization = await device.wait()
```

## Return type

### expiresIn

- **Type:** `number`

Seconds until the code expires. The action always requests a key authorization, so a new code lasts 300 seconds.

### userCode

- **Type:** `string`

The code that the user confirms: eight consonants in two groups of four, such as `WDJB-MJHT`.

### verificationUri

- **Type:** `string`

Tempo ID's `/device` page, where the user enters the code.

### verificationUriComplete

- **Type:** `string`

The device page, with the code filled in.

### wait

- **Type:** `() => Promise<Authorization.Authorization>`, with [`Authorization`](types.md#authorization)

Polls every 5 seconds, as Tempo ID sets, and adds 5 seconds after each `slow_down`. It resolves with the authorization once the user approves, and throws when the user denies the code or it expires.

## Parameters

### accessKey

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, and the app's own access key as `account`. The grant always authorizes an access key, so the call names its `limits` and `scopes`, or Tempo ID refuses it with [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions). The action sends the fields as given. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). The user approves the access key on the device page, so it may exceed the headless ceiling.

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the one that the user selects at sign-in, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere.

```ts
const device = await Actions.device.authorize(config, {
  accessKey: {
    account: Account.fromSecp256k1(privateKey),
    expiry: Expiry.days(30),
    limits: [{ limit: 50_000_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const device = await Actions.device.authorize(config, {
  accessKey,
  challenge,
})
```

### device (optional)

- **Type:** `string`
- **Default:** The machine's hostname in Node, Bun, and Deno, or `'Unknown device'` elsewhere

The name that the approval page shows for the machine, up to 64 characters.

```ts
const device = await Actions.device.authorize(config, {
  accessKey,
  device: 'build-server',
})
```

### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#device-grant) describes. After the approval, an account that holds less opens Tempo ID's funding page in place of the approved screen. `wait` returns the tokens either way.

```ts
const device = await Actions.device.authorize(config, {
  accessKey,
  funding: { amount: '10', currency: 'USD' },
})
```

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses the code request, or by `wait`, with one of these `reason` values, or one of these `code` values from the token endpoint.

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

- **`expired_token`:** `wait` polled until `expiresIn` passed. Request a new code.
