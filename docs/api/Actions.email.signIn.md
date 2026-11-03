# Actions.email.signIn

## Overview

Signs the user in with the code that Tempo ID emailed, and authorizes the app in the same request. Only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) authorizes this way, and the access key must fit the headless ceiling. The action sends one request: `POST /v1/auth/code/verify` with the authorization request as `authorize`. Tempo ID signs the user in, creates the user's first Tempo Account if the user holds none and the sign-in authorizes an access key, and authorizes the app, as [`Actions.authorize`](Actions.authorize.md) does.

A refusal that depends only on the app and the request, such as an access key over the headless ceiling, throws before the sign-in, and the code stays valid. A refusal after the sign-in has `signedIn: true`, such as for a scope that the app's registration lacks.

With `link`, the action first sends `POST /v1/auth/passkey/options`, and the passkey signs the access key's digest. `POST /v1/auth/code/verify` then signs the user in, links the passkey, and returns the authorization.

In a browser, or with `getFn`, a passkey that owns the account, such as a wallet.tempo passkey, signs the access key after the code. `POST /v1/auth/code/verify` returns the [passkey step](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#headless-key-authorizations), the passkey signs the access key's digest on the page, and `POST /v1/authorize` returns the signed access key.

With `account`, the same request returns the user's Tempo Account, as [`Actions.account.get`](Actions.account.get.md) does, and creates one for a user who holds none. With `registration`, it returns the options of a passkey registration, which [`Actions.passkey.register`](Actions.passkey.register.md) takes. A page that signs up a user and then registers a passkey thus sends no request between the sign-in and the registration's last request. Where Tempo ID leaves the accounts out, such as at the user's limit of account reads, the result has no `account`, and `Actions.account.get` then returns the refusal. The authorization stays valid.

On a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md), a wallet.tempo passkey's account may wait for its upgrade. The access key then signs as the passkey's own account, and `upgradeAvailable` is `true`. For a user without an account, the passkey step names the wallet.tempo passkey of the email, which links to the user once it signs, as [Upgrade after an emailed code](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#upgrade-after-an-emailed-code) describes.

## Usage

```ts
import { Actions } from 'accounts'
import { Expiry, Scopes } from 'viem/tempo'

// An access key that may transfer up to 10 OUSD for a day.
const accessKey = {
  expiry: Expiry.days(1),
  limits: [{ limit: 10_000_000n, token: ousd }],
  scopes: [Scopes.tip20(ousd).transfer()],
}
const authorization = await Actions.email.signIn(config, {
  accessKey,
  code: '123456',
  email: 'user@example.com',
})
```

Without `accessKey`, the action authorizes no access key, creates no Tempo Account, and returns the tokens and the user alone:

```ts
const signedIn = await Actions.email.signIn(config, { code, email })
```

## Return type

`Authorization.Authorization & { upgradeAvailable: boolean }`, with [`Authorization`](types.md#authorization)

The tokens, the access key, and the user, with `upgradeAvailable`. Without `accessKey`, it omits `accessKey` and `key`.

### account

- **Type:** [`TempoAccount`](types.md#tempoaccount) `| undefined`

The user's Tempo Account for the app, as `Actions.account.get` returns it, for a sign-in with `account`. `undefined` for a user without one in the app's realms. Absent without `account`, and where Tempo ID left the accounts out, such as at the user's limit of account reads. Then read them with [`Actions.account.get`](Actions.account.get.md), which throws the refusal.

```ts
const { account } = await Actions.email.signIn(config, {
  account: { chain: 'testnet' },
  code,
  email,
})
```

### registration

- **Type:** `Registration`

The options of a passkey registration, which expire after 4 minutes, for a sign-in with `registration: true`. Pass them to [`Actions.passkey.register`](Actions.passkey.register.md#registration-optional). Absent where `POST /v1/account/passkey/options` refuses them, such as on the page of an app without the `tempo-id:sign` scope. `Actions.passkey.register` then requests them, and throws the refusal.

```ts
const { registration } = await Actions.email.signIn(config, {
  code,
  email,
  registration: true,
})
await Actions.passkey.register(config, { registration })
```

### upgradeAvailable

- **Type:** `boolean`

Whether the access key's account is a wallet.tempo passkey's that waits for its upgrade on the access key's chain, where accounts are [configurable](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md). The access key signed as the passkey's own account. [`Actions.account.upgrade`](Actions.account.upgrade.md) with the access key upgrades the account with one more passkey prompt, and the access key keeps working.

```ts
if (authorization.upgradeAvailable)
  await Actions.account.upgrade(config, { key: authorization.key })
```

## Parameters

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`. Without it, the call authorizes no access key, and takes no `challenge`. The action sends the fields as given. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). The access key names its `limits` and `scopes`, within the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`. Such an app may request an [access key without bounds](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#access-keys-without-bounds).

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the app's selected account, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere.

```ts
const authorization = await Actions.email.signIn(config, {
  accessKey: {
    account,
    expiry: Expiry.days(1),
    limits: [{ limit: 10_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
  code,
  email,
})
```

### account (optional)

- **Type:** `Pick<Actions.account.get.Options, 'chain' | 'chainId' | 'getFn'>`

Returns the user's Tempo Account as `account`, with these options of [`Actions.account.get`](Actions.account.get.md#parameters), in the same request as the sign-in. A user without one receives one. An unknown `chain` throws `invalid_field` before the sign-in, and the code stays valid.

```ts
const { account } = await Actions.email.signIn(config, {
  account: { chain: 'testnet' },
  code,
  email,
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const authorization = await Actions.email.signIn(config, {
  accessKey,
  challenge,
  code,
  email,
})
```

### code

- **Type:** `string`

The 6-digit code that Tempo ID emailed.

```ts
const authorization = await Actions.email.signIn(config, {
  code: '123456',
  email: 'user@example.com',
})
```

### email

- **Type:** `string`

The address that received the code.

```ts
const authorization = await Actions.email.signIn(config, {
  code: '123456',
  email: 'user@example.com',
})
```

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the ceremony of the passkey that `link` names, or of the passkey that owns the account, as in [`Actions.passkey.signIn`](Actions.passkey.signIn.md#getfn-optional). Outside a browser, a call without `getFn` signs no passkey-owned access key.

```ts
const authorization = await Actions.email.signIn(config, {
  code,
  email,
  getFn: (options) => Passkeys.get(options),
  link: step.link,
})
```

### link (optional)

- **Type:** `string`

The `link` from the email step of [`Actions.passkey.signIn`](Actions.passkey.signIn.md), which links that wallet.tempo passkey to the user. The action first runs the passkey's ceremony, and Tempo ID links it only with that assertion. The assertion signs the access key too, as in a [sign-in with key signature](https://github.com/tempoxyz/id/blob/main/docs/sign-in-with-key-signature.md#app-pages).

The link lasts 5 minutes. If the ceremony fails or the link expires, the code stays valid, so call again without `link` to sign in with email only.

```ts
const authorization = await Actions.email.signIn(config, {
  code,
  email,
  link: step.link,
})
```

### registration (optional)

- **Type:** `boolean`
- **Default:** `false`

Returns the options of a passkey registration as `registration`, in the same request as the sign-in.

```ts
const { registration } = await Actions.email.signIn(config, {
  code,
  email,
  registration: true,
})
```

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses a request, with one of these `reason` values.

#### Sign-in

After a refusal of a `link`, the code stays valid, so call again without `link`.

- [`invalid_code`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_code): The code is wrong or expired.
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The address has no user, and its domain is not one of the deployment's [sign-up domains](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#sign-up-domains). Sign in with an existing account, or with an address at one of those domains.
- [`passkey_link_expired`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_link_expired): The `link` expired, or the browser holds no link cookie for it.
- [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted): The passkey's relying party does not cover the app's realms or page.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): With `link`, the page's origin is no redirect URI's origin.
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion of the passkey that `link` names did not verify.

#### Authorization request

Tempo ID checks the authorization request before the code, so the code stays valid, and the error's [`signedIn`](Id.RequestError.md#signedin) is `false`.

- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The request came from an origin other than the redirect URI's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): Tempo ID refused the app or its request.
- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An app with `tempo-id:sign` has no ceiling.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

#### Authorization

The user is signed in, and the error's [`signedIn`](Id.RequestError.md#signedin) is `true`.

- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names a Tempo Account that is not the user's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): The user holds no Tempo Account, and the app's first realm creates none.
- [`upgrade_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upgrade_required): The call cannot run a passkey ceremony, and the access key waits for a wallet.tempo passkey's upgrade. For a user without an account, `meta.credentialId` names the email's passkey.
- [`session_changed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_changed): Only from a server that returns no authorization with the sign-in. Another sign-in replaced the session after this one verified. Sign in again.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): A passkey owns the Tempo Account, and the call cannot run its ceremony: there is no browser or `getFn`, the passkey's relying party does not cover the page, or the ceremony failed, such as when the user dismisses the prompt. Authorize through [`Actions.redirect.start`](Actions.redirect.start.md).
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion of the passkey step did not verify, or was spent before.

#### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.

### `Authentication.SignFailedError`

Thrown, from `ox/webauthn`, when the ceremony of the passkey that `link` names fails. The code stays valid. A failed ceremony of the passkey step comes after the sign-in, so it throws `webauthn_required` with `signedIn: true` instead, with the ceremony's error as `cause`.

### `Id.ChallengeWithoutKeyError`

Thrown before any request when the call receives `challenge` without `accessKey`.
