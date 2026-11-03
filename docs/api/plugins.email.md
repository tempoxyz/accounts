# email

## Overview

The plugin of sign-in with an emailed code, which adds `tempoId.email.sendCode` and `tempoId.email.signIn`. An app renders its own form, and Tempo ID emails a 6-digit code to the address. On a page, only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs in this way, at the origin of one of its redirect URIs, and the access key must fit the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`.

On an instance with `clientSecret` or `clientAssertion`, which only a backend holds, the plugin calls the backend's routes instead: [`Actions.backend.email.sendCode`](Actions.backend.email.sendCode.md) and [`Actions.backend.email.signIn`](Actions.backend.email.signIn.md), as [Backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md) describes. A backend's instance holds no session, so it saves the result with [`backend.save`](plugins.backend.md#backendsave).

## Usage

```ts
import { Id } from 'accounts'
import { email } from 'accounts/plugins'

const tempoId = Id.create({ plugins: [email()] })

await tempoId.email.sendCode({ email: 'user@example.com' })
const session = await tempoId.email.signIn({
  code: '123456',
  email: 'user@example.com',
})
```

## Return type

`Plugin<'email', { sendCode, signIn }>`

### email.sendCode

- **Type:** `(parameters: { email: string; userIp?: string }) => Promise<void>`

Emails a sign-in code to `email`, as [`Actions.email.sendCode`](Actions.email.sendCode.md) does. The response is the same for every address, so it reveals no account. On a backend, `userIp` is the end user's IP address, which rate limits count in place of the backend's.

```ts
await tempoId.email.sendCode({ email: 'user@example.com' })
```

### email.signIn

- **Type:** `(parameters: email.signIn.Parameters) => Promise<Session & { upgradeAvailable: boolean }>`

Signs the user in with the emailed code, sets the instance's [session](types.md#session), and returns it, as [`Actions.email.signIn`](Actions.email.signIn.md) does. With `accessKey`, the session holds an access key. On a page, the session holds the user's Tempo Account from the sign-in's own response, with no request after it. A chain that Tempo ID does not list leaves the account out. `upgradeAvailable` is `true` for a wallet.tempo passkey's account that waits for its [upgrade](Id.create.md#accountupgrade).

```ts
const session = await tempoId.email.signIn({ code, email: address })
```

## Parameters

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the ceremony of the passkey that a sign-in's `link` names, or of the passkey that owns the account, in place of `navigator.credentials.get`.

```ts
const tempoId = Id.create({
  plugins: [email({ getFn: (options) => Passkeys.get(options) })],
})
```

### email.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
const session = await tempoId.email.signIn({
  accessKey: false,
  code,
  email: address,
})
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope and an access key.

```ts
const session = await tempoId.email.signIn({ challenge, code, email: address })
```

#### code

- **Type:** `string`

The 6-digit code that Tempo ID emailed.

```ts
const session = await tempoId.email.signIn({ code: '123456', email: address })
```

#### email

- **Type:** `string`

The address that received the code.

```ts
const session = await tempoId.email.signIn({ code, email: 'user@example.com' })
```

#### link (optional)

- **Type:** `string`

The `link` from the email step of [`passkey.signIn`](plugins.passkey.md#passkeysignin), which links that passkey to the user. The call first runs the passkey's ceremony. If the ceremony fails or the link expires, the code stays valid, so call again without `link`.

```ts
const session = await tempoId.email.signIn({
  code,
  email: address,
  link: step.link,
})
```

#### userIp (optional)

- **Type:** `string`

The end user's IP address, which rate limits count. Only a backend sends it.

```ts
const session = await tempoId.email.signIn({
  code,
  email: address,
  userIp: c.req.header('cf-connecting-ip'),
})
```

## Errors

### `Id.RequestError`

Thrown for each refusal that [`Actions.email.sendCode`](Actions.email.sendCode.md#errors) and [`Actions.email.signIn`](Actions.email.signIn.md#errors) list, or on a backend, that [`Actions.backend.email.signIn`](Actions.backend.email.signIn.md#errors) lists. A refusal after the sign-in has `signedIn: true`, and empties the session.

### `Id.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.

### `Id.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
