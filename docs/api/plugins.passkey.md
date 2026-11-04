# passkey

## Overview

The plugin of sign-in with a passkey, and of the registration of one. It adds `accounts.passkey.available`, `accounts.passkey.prepare`, `accounts.passkey.register`, and `accounts.passkey.signIn`. The browser offers every passkey of the relying party of the app's realms, so the form needs no email. Only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs in this way, on a page that the relying party covers.

A wallet.tempo passkey that no account knows yet returns the email step. The [`email`](plugins.email.md) plugin's `signIn` with the step's `link` then links the passkey, so an instance with this plugin usually holds `email` too.

## Usage

```ts
import { Accounts } from 'accounts'
import { email, passkey } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [passkey(), email()] })

const result = await accounts.passkey.signIn()
if ('step' in result) showEmailForm({ link: result.step.link })
```

## Return type

`Plugin<'passkey', { available, prepare, register, signIn }>`

### passkey.available

- **Type:** `() => Promise<boolean>`

Returns whether a passkey sign-in runs on this page. Never rejects.

```ts
if (await accounts.passkey.available()) showPasskeyButton()
```

### passkey.prepare

- **Type:** `(parameters?: passkey.signIn.Parameters) => { available: Promise<boolean>; signIn: () => Promise<passkey.signIn.ReturnType> }`

Prepares a passkey sign-in before the user's gesture, such as when the form shows, and returns its handle. The handle's `signIn` starts the ceremony without a request, and sets the instance's session as `passkey.signIn` does. It requests new options if the handle holds none, or if they are older than 4 minutes. The call never throws. Create a new handle when `accessKey` changes.

```ts
const prepared = accounts.passkey.prepare()
if (await prepared.available) showPasskeyButton()

// On the passkey button:
const result = await prepared.signIn()
```

### passkey.register

- **Type:** `(parameters?: passkey.register.Parameters) => Promise<{ address: string; id: string }>`

Registers a new passkey for the signed-in user, with the plugin's `getFn`. On a chain whose accounts are configurable, the passkey joins the account of `key` as an owner. Leaves the session as it is. Call it from a click, since the user approves two prompts.

```ts
const session = await accounts.email.signIn({ code, email: address })
await accounts.passkey.register({ key: session.key })
```

### passkey.signIn

- **Type:** `(parameters?: passkey.signIn.Parameters) => Promise<passkey.signIn.ReturnType>`

Signs the user in with a passkey, sets the instance's [session](types.md#session), and returns it with `upgradeAvailable`. Returns the email step, `{ step: { link, type: 'email' } }`, with no change to the session, for a passkey that no account knows yet. Without an access key, the session holds the user's Tempo Account, which one more request reads.

```ts
const result = await accounts.passkey.signIn({ mediation: 'conditional' })
```

## Parameters

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the passkey ceremony in place of `navigator.credentials.get`, such as on a device. Its assertion must report the page's origin.

```ts
const accounts = Accounts.create({
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
const result = await accounts.passkey.signIn({ accessKey: false })
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope and an access key.

```ts
const result = await accounts.passkey.signIn({ challenge })
```

#### credentialId (optional)

- **Type:** `string | readonly string[]`
- **Default:** Every passkey

The credential ID, or up to 16 IDs, that the browser offers.

```ts
const result = await accounts.passkey.signIn({ credentialId: saved.id })
```

#### mediation (optional)

- **Type:** `'conditional' | 'optional' | 'required' | 'silent'`
- **Default:** The browser's own

The browser's mediation, such as `conditional` for autofill.

```ts
const result = await accounts.passkey.signIn({ mediation: 'conditional' })
```

#### select (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the browser offers every passkey of the relying party, such as to switch accounts. With a session and without it, the browser offers only the signed-in user's passkeys.

```ts
const result = await accounts.passkey.signIn({ select: true })
```

### passkey.register parameters

#### account (optional)

- **Type:** `` `0x${string}` ``
- **Default:** `key.account` on a chain whose accounts are configurable, else none

A configurable Tempo Account of the user's cloud wallet, which the passkey joins as a second owner on `chain`. Without one, the passkey owns an account of its own.

```ts
await accounts.passkey.register({ account: session.account!.address })
```

#### chain (optional)

- **Type:** `number | string`
- **Default:** The chain of `key` when its accounts are configurable, else the first such chain for `account`

The chain whose accounts are configurable, by its name in `GET /v1/chains`, such as `testnet`, or its ID. It selects where `account` is, and the chain of the address that the call returns. Tempo ID refuses an unknown chain with `invalid_field` at the last request, after both ceremonies.

```ts
await accounts.passkey.register({ chain: 'testnet' })
```

#### chainId (optional)

- **Type:** `number`

The chain whose accounts are configurable, by its ID, in place of `chain`.

```ts
await accounts.passkey.register({ chainId: 42431 })
```

#### createFn (optional)

- **Type:** `Registration.create.Options['createFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.create`

Runs the creation ceremony in place of `navigator.credentials.create`.

```ts
await accounts.passkey.register({
  createFn: (options) => Passkeys.create(options),
})
```

#### key (optional)

- **Type:** ``{ account: `0x${string}`; chainId: number }``

The access key of a sign-in on the cloud wallet's account, such as `session.key`. On a chain whose accounts are configurable, it sets the default `account` and `chain`. Registration does not use the access key otherwise.

```ts
await accounts.passkey.register({ key: session.key })
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses a request, with its `reason`. A refusal after the sign-in has `signedIn: true`, and empties the session.

#### passkey.signIn

##### Sign-in

- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): Tempo ID refused the passkey or its challenge. Sign in again.
- [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted): No realm's relying party covers both the page and Tempo ID.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The page's origin is missing, or is no redirect URI's origin.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): The app is not a first-party app, or is a native app, which signs in through [`redirect.signIn`](plugins.redirect.md#redirectsignin) ([mobile guide](../guides/mobile.md)).
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The wallet.tempo passkey's address has no user, and its domain is not one of the deployment's [sign-up domains](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#sign-up-domains).

##### Authorization

The user is signed in, and the error's [`signedIn`](Accounts.RequestError.md#signedin) is `true`.

- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names a Tempo Account that is not the user's.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The request came from an origin other than the redirect URI's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): Tempo ID refused the app or its request, or the user holds no Tempo Account.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): Another passkey owns the Tempo Account. Authorize through [`redirect.signIn`](plugins.redirect.md#redirectsignin).

##### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An app with `tempo-id:sign` has no ceiling. These return before the ceremony, so the user is not signed in.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

##### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, such as a padded `credentialId`, or a retry later may succeed.

#### passkey.register

- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID.
- [`reauthentication_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reauthentication_required): The session signed in more than 10 minutes before. Sign in again.
- [`passkey_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_limit): The user holds 10 passkeys.
- [`passkey_register_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_register_not_permitted): No app at the page's origin holds the `tempo-id:sign` scope.
- [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted): The `default` realm's relying party does not cover the page and Tempo ID.
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The credential or the proof does not verify, its step expired, or Tempo ID or wallet.tempo stores the credential ID. Run the action again.
- [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled): The chain's accounts are not configurable.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): `account` is not the user's in the `default` realm.
- [`not_configurable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#not_configurable): `account` is not configurable yet.
- [`owner_exists`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#owner_exists): A passkey owns `account` already.
- [`config_conflict`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#config_conflict): The chain holds a configuration that Tempo ID did not send.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account changes. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): wallet.tempo or the chain failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

### `Accounts.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending, also after the email step.

### `Accounts.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
