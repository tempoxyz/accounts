# Actions.passkey.prepare

## Overview

Prepares a passkey sign-in before the user acts, such as when the sign-in form shows, and returns its handle. The handle's `signIn` then starts the ceremony at once, and sends only `POST /v1/auth/passkey/verify`.

The action never throws. It reads [`Actions.passkey.available`](Actions.passkey.available.md), and only where that returns `true`, sends `POST /v1/auth/passkey/options`, as [`Actions.passkey.signIn`](Actions.passkey.signIn.md) does. So no request fails on a page without passkeys. A failed request leaves no options, and the handle's `signIn` requests them, and throws the refusal.

The handle owns its options:

- A sign-in uses them once. A sign-in that starts before another one ends requests options of its own.
- The options last 4 minutes from the request, a minute short of their challenge's 5 minutes. A sign-in after that requests new options.
- A ceremony that sends no assertion, such as one that the user cancels, leaves the options for the next sign-in.
- A sign-in that sends its assertion spends the challenge. After a refusal, the handle requests new options for the next sign-in.

The handle keeps the parameters of the call. Create a new handle when they change, such as for another `accessKey`.

On a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md), a wallet.tempo passkey's account may wait for its upgrade. The access key then signs as the passkey's own account, and `upgradeAvailable` is `true`.

## Usage

```ts
import { Actions } from 'accounts'

// Once the sign-in form shows:
const passkey = Actions.passkey.prepare(config, { accessKey })
if (await passkey.available) showPasskeyButton()

// On the passkey button:
const result = await passkey.signIn()
```

## Return type

`{ available: Promise<boolean>; signIn: (options?) => Promise<…> }`

### available

- **Type:** `Promise<boolean>`

Whether a passkey sign-in for the app runs on this page, as `Actions.passkey.available` returns. It never rejects, and resolves to `false` when the read fails.

### signIn

- **Type:** `(options?: { getFn? }) => Promise<Actions.passkey.signIn.ReturnType>`

Signs in as [`Actions.passkey.signIn`](Actions.passkey.signIn.md) does, with the handle's options. It takes only [`getFn`](Actions.passkey.signIn.md#getfn-optional), returns what `Actions.passkey.signIn` returns, and throws what it throws.

```ts
const result = await passkey.signIn({ getFn })
```

## Parameters

Each parameter is the same as in [`Actions.passkey.signIn`](Actions.passkey.signIn.md#parameters), apart from `getFn`, which only the handle's `signIn` takes.

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`, which defaults to a new access key. Without it, the sign-in authorizes no access key, and takes no `challenge`.

```ts
const passkey = Actions.passkey.prepare(config, {
  accessKey: {
    account,
    expiry: '1h',
    limits: [{ limit: '10', token: 'ousd' }],
  },
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`.

```ts
const passkey = Actions.passkey.prepare(config, { accessKey, challenge })
```

### credentialId (optional)

- **Type:** `readonly string[] | string`
- **Default:** Every passkey of the relying party

The credential ID, or up to 16 IDs, that the browser offers.

```ts
const passkey = Actions.passkey.prepare(config, { credentialId })
```

### mediation (optional)

- **Type:** `'conditional' | 'optional' | 'required' | 'silent'`
- **Default:** The browser's default

How the browser mediates the ceremony.

```ts
const passkey = Actions.passkey.prepare(config, {
  mediation: 'conditional',
})
```

### select (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the browser offers every passkey of the relying party, for a sign-in that starts with no known user, such as one that switches accounts. By default, a page with a session offers only the [signed-in user's](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#signed-in-user) passkeys. Leave out `credentialId` with it.

```ts
const result = await Actions.passkey.prepare(config, { select: true })
```

## Errors

The action throws nothing. The handle's `signIn` throws the errors of [`Actions.passkey.signIn`](Actions.passkey.signIn.md#errors), such as [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted) and [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin), and `Accounts.ChallengeWithoutKeyError` for a `challenge` without `accessKey`.
