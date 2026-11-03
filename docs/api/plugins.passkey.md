# passkey

## Overview

The plugin of sign-in with a passkey, and of the registration of one. It adds `tempoId.passkey.available`, `tempoId.passkey.prepare`, `tempoId.passkey.register`, and `tempoId.passkey.signIn`. The browser offers every passkey of the relying party of the app's realms, so the form needs no email. Only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs in this way, on a page that the relying party covers.

A wallet.tempo passkey that no account knows yet returns the email step. The [`email`](plugins.email.md) plugin's `signIn` with the step's `link` then links the passkey, so an instance with this plugin usually holds `email` too.

## Usage

```ts
import { Id } from 'accounts'
import { email, passkey } from 'accounts/plugins'

const tempoId = Id.create({ plugins: [passkey(), email()] })

const result = await tempoId.passkey.signIn()
if ('step' in result) showEmailForm({ link: result.step.link })
```

## Return type

`Plugin<'passkey', { available, prepare, register, signIn }>`

### passkey.available

- **Type:** `() => Promise<boolean>`

Returns whether a passkey sign-in runs on this page, as [`Actions.passkey.available`](Actions.passkey.available.md) does. Never rejects.

```ts
if (await tempoId.passkey.available()) showPasskeyButton()
```

### passkey.prepare

- **Type:** `(parameters?: passkey.signIn.Parameters) => { available: Promise<boolean>; signIn: () => Promise<passkey.signIn.ReturnType> }`

Prepares a passkey sign-in before the user's gesture, such as when the form shows, as [`Actions.passkey.prepare`](Actions.passkey.prepare.md) does, and returns its handle. The handle's `signIn` starts the ceremony without a request, and sets the instance's session as `passkey.signIn` does. It requests new options if the handle holds none, or if they are older than 4 minutes. The call never throws. Create a new handle when `accessKey` changes.

```ts
const prepared = tempoId.passkey.prepare()
if (await prepared.available) showPasskeyButton()

// On the passkey button:
const result = await prepared.signIn()
```

### passkey.register

- **Type:** `(parameters?: Omit<Actions.passkey.register.Options, 'getFn'>) => Promise<{ address: string; id: string }>`

Registers a new passkey for the signed-in user, as [`Actions.passkey.register`](Actions.passkey.register.md) does, with the plugin's `getFn`. On a chain whose accounts are configurable, the passkey joins the account of `key` as an owner. Leaves the session as it is. Call it from a click, since the user approves two prompts.

```ts
const session = await tempoId.email.signIn({ code, email: address })
await tempoId.passkey.register({ key: session.key })
```

### passkey.signIn

- **Type:** `(parameters?: passkey.signIn.Parameters) => Promise<passkey.signIn.ReturnType>`

Signs the user in with a passkey, sets the instance's [session](types.md#session), and returns it with `upgradeAvailable`, as [`Actions.passkey.signIn`](Actions.passkey.signIn.md) does. Returns the email step, `{ step: { link, type: 'email' } }`, with no change to the session, for a passkey that no account knows yet. Without an access key, the session holds the user's Tempo Account, which one more request reads.

```ts
const result = await tempoId.passkey.signIn({ mediation: 'conditional' })
```

## Parameters

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the passkey ceremony in place of `navigator.credentials.get`, such as on a device. Its assertion must report the page's origin.

```ts
const tempoId = Id.create({
  plugins: [passkey({ getFn: (options) => Passkeys.get(options) })],
})
```

### passkey.signIn parameters

`passkey.prepare` takes the same parameters.

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
const result = await tempoId.passkey.signIn({ accessKey: false })
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope and an access key.

```ts
const result = await tempoId.passkey.signIn({ challenge })
```

#### credentialId (optional)

- **Type:** `string | readonly string[]`
- **Default:** Every passkey

The credential ID, or up to 16 IDs, that the browser offers.

```ts
const result = await tempoId.passkey.signIn({ credentialId: saved.id })
```

#### mediation (optional)

- **Type:** `'conditional' | 'optional' | 'required' | 'silent'`
- **Default:** The browser's own

The browser's mediation, such as `conditional` for autofill.

```ts
const result = await tempoId.passkey.signIn({ mediation: 'conditional' })
```

#### select (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the browser offers every passkey of the relying party, such as to switch accounts. With a session and without it, the browser offers only the signed-in user's passkeys.

```ts
const result = await tempoId.passkey.signIn({ select: true })
```

## Errors

### `Id.RequestError`

Thrown for each refusal that [`Actions.passkey.signIn`](Actions.passkey.signIn.md#errors) and [`Actions.passkey.register`](Actions.passkey.register.md#errors) list. A refusal after the sign-in has `signedIn: true`, and empties the session.

### `Id.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending, also after the email step.

### `Id.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
