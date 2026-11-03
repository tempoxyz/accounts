# device

## Overview

The plugin of sign-in with the [device grant](https://github.com/tempoxyz/id/blob/main/docs/device-grant.md) ([RFC 8628](https://www.rfc-editor.org/rfc/rfc8628)), such as for a CLI, which adds `tempoId.device.signIn`. The sign-in passes the user code to `onCode`, waits for the user to approve it on Tempo ID's device page in any browser, sets the instance's session, and returns it. No redirect URI or local server is involved.

The grant always requests an access key. The user approves its limits, so they may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling). Outside a browser, the instance holds the session only with a `store`, such as [`Store.file`](Store.file.md).

## Usage

```ts
import { Id, Store } from 'accounts'
import { device } from 'accounts/plugins'

const tempoId = Id.create({
  accessKey: () => ({
    expiry: Expiry.days(7),
    limits: [{ limit: 100_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
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

if (!(await tempoId.session.get())) await tempoId.device.signIn()
```

## Return type

`Plugin<'device', { signIn }>`

### device.signIn

- **Type:** `(parameters?: device.signIn.Parameters) => Promise<Session>`

Starts the device grant, as [`Actions.device.authorize`](Actions.device.authorize.md) does, and passes its code to `onCode`. It then polls until the user approves the code, sets the instance's [session](types.md#session), and returns it. The code expires after 10 minutes. The session holds no Tempo Account.

```ts
const { user } = await tempoId.device.signIn()
```

## Parameters

### onCode

- **Type:** `(code: device.Code) => Promise<void> | void`

Shows the user code and the page to approve it on, such as in a terminal.

```ts
const tempoId = Id.create({
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
const session = await tempoId.device.signIn({
  accessKey: {
    expiry: Expiry.days(365),
    limits: [{ limit: 1_000_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope.

```ts
const session = await tempoId.device.signIn({ challenge })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account. After the approval, an account that holds less opens Tempo ID's funding page in place of the approved screen, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes.

```ts
const session = await tempoId.device.signIn({ funding: { amount: '10' } })
```

## Errors

### `Id.KeyRequiredError`

Thrown before any request when neither the call nor the instance names an access key, or when the call passes `accessKey: false`.

### `Id.RequestError`

Thrown for each refusal that [`Actions.device.authorize`](Actions.device.authorize.md#errors) lists, such as when the user denies the code, or the code expires.

### `Id.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.
