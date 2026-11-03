# Actions.passkey.signIn

## Overview

Signs the user in with a passkey, and authorizes the app with the same assertion ([sign-in with key signature](https://github.com/tempoxyz/id/blob/main/docs/sign-in-with-key-signature.md#app-pages)). Only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs in this way, and the access key must fit the headless ceiling. The action sends two requests:

1. `POST /v1/auth/passkey/options` checks the headless ceiling, and returns a challenge that is the access key's digest.
2. `POST /v1/auth/passkey/verify` signs the user in, and returns the authorization. The assertion signs the access key of a passkey-owned Tempo Account. A Privy-owned account's wallet signs it on the server, and a user without an account receives one.

The handle that [`Actions.passkey.prepare`](Actions.passkey.prepare.md) returns sends the first request before the user acts, so its sign-in starts the ceremony at once.

On a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md), a wallet.tempo passkey's account may wait for its upgrade. The access key then signs as the passkey's own account, and `upgradeAvailable` is `true`.

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
const result = await Actions.passkey.signIn(config, { accessKey })
if ('step' in result) showEmailForm({ link: result.step.link })
```

The page must run on the domain of the realms' relying party, such as `app.tempo.xyz` for `tempo.xyz`. Its origin must be a redirect URI's origin, as [Passkeys](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#app-pages) describes.

## Return type

`(Authorization.Authorization & { upgradeAvailable: boolean }) | { step: { link: string, type: 'email' } }`, with [`Authorization`](types.md#authorization)

The tokens, the access key, and the user, with `upgradeAvailable`. Without `accessKey`, it omits `accessKey` and `key`. A wallet.tempo passkey whose account has no email returns the email step. Pass its `link` to [`Actions.email.signIn`](Actions.email.signIn.md), with the same `accessKey` and `challenge`.

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

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the app's selected account, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere. Without `account`, `publicKey` and `type` name an access key whose private key the page does not hold, such as one on the app's server, and `type` defaults to `secp256k1`. The result's `accessKey` then rejects each signature with `AccessKey.AccessKeyRequiredError`.

```ts
const result = await Actions.passkey.signIn(config, {
  accessKey: {
    account,
    expiry: Expiry.days(1),
    limits: [{ limit: 10_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const result = await Actions.passkey.signIn(config, { accessKey, challenge })
```

### credentialId (optional)

- **Type:** `readonly string[] | string`
- **Default:** Every passkey of the relying party

The credential ID, or up to 16 IDs, that the browser offers. Each is unpadded base64url of 1 to 1,023 bytes, as in `PublicKeyCredential.id`. An empty list offers every passkey.

```ts
const result = await Actions.passkey.signIn(config, { credentialId })
```

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the WebAuthn ceremony, such as with a test authenticator. The assertion must report the page's origin, so Tempo ID refuses an Android facet origin with `webauthn_rejected`.

```ts
const result = await Actions.passkey.signIn(config, {
  getFn: (options) => Passkeys.get(options),
})
```

### mediation (optional)

- **Type:** `'conditional' | 'optional' | 'required' | 'silent'`
- **Default:** The browser's default

How the browser mediates the ceremony. `conditional` offers the passkeys in autofill, from an input with `autocomplete="username webauthn"`. Its challenge expires after 5 minutes, and a later selection throws `webauthn_rejected`, so call again.

```ts
const result = await Actions.passkey.signIn(config, {
  mediation: 'conditional',
})
```

### select (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the browser offers every passkey of the relying party, for a sign-in that starts with no known user, such as one that switches accounts. By default, a page with a session offers only the [signed-in user's](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#signed-in-user) passkeys. Leave out `credentialId` with it.

```ts
const result = await Actions.passkey.signIn(config, { select: true })
```

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses a request, with one of these `reason` values.

#### Sign-in

- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): Tempo ID refused the passkey or its challenge. Sign in again.
- [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted): No realm's relying party covers both the page and Tempo ID.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The page's origin is missing, or is no redirect URI's origin.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): The app is not a first-party app, or is a native app, which signs in through [`Actions.redirect.createUrl`](Actions.redirect.createUrl.md) ([mobile guide](../guides/mobile.md)).
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The wallet.tempo passkey's address has no user, and its domain is not one of the deployment's [sign-up domains](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#sign-up-domains).

#### Authorization

The user is signed in, and the error's [`signedIn`](Id.RequestError.md#signedin) is `true`.

- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names a Tempo Account that is not the user's.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The request came from an origin other than the redirect URI's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): Tempo ID refused the app or its request, or the user holds no Tempo Account.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): Another passkey owns the Tempo Account. Authorize through [`Actions.redirect.start`](Actions.redirect.start.md).

#### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An app with `tempo-id:sign` has no ceiling. These return before the ceremony, so the user is not signed in.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

#### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, such as a padded `credentialId`, or a retry later may succeed.

### `Authentication.SignFailedError`

Thrown, from `ox/webauthn`, when the ceremony fails, such as when the user dismisses it.

### `Id.ChallengeWithoutKeyError`

Thrown before any request when the call receives `challenge` without `accessKey`.
