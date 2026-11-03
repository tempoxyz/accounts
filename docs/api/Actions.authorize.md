# Actions.authorize

## Overview

Authorizes a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) for a user already signed in to Tempo ID, from a page on a redirect URI's origin. The access key must fit the headless ceiling. Another app authorizes through [`Actions.redirect.start`](Actions.redirect.start.md). The action sends two requests:

1. `GET /v1/auth/session` checks the session.
2. `POST /v1/authorize` authorizes the app. A Privy-owned account's wallet signs the access key.

With `passkey`, a passkey that owns the account signs the access key on the page. `POST /v1/authorize` returns the [passkey step](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#headless-key-authorizations), the passkey signs the access key's digest, and a second `POST /v1/authorize` returns the signed access key. The ceremony prompts the user, so call the action from a click.

With an access key, a user who holds no Tempo Account in the app's realms receives a first one in the app's first realm, as [`Actions.account.get`](Actions.account.get.md) creates it.

On a chain with [configurable accounts](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md), a wallet.tempo passkey's account may wait for its upgrade. With `passkey`, the passkey signs the access key as its own account, and `upgradeAvailable` is `true`. Without `passkey`, such an account throws `upgrade_required`, since no passkey signs the access key. A user without an account whose email holds a wallet.tempo passkey that has not linked signs with that passkey too, and without `passkey` the refusal's `meta.credentialId` names it.

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
const result = await Actions.authorize(config, { accessKey })
if (!result) showSignIn()
```

Without `accessKey`, the action authorizes no access key, and returns the tokens and the user alone:

```ts
const signedIn = await Actions.authorize(config)
```

## Return type

`(Authorization.Authorization & { account?: TempoAccount.TempoAccount; upgradeAvailable: boolean }) | undefined`, with [`Authorization`](types.md#authorization)

The tokens, the access key, and the user, with `account` and `upgradeAvailable`. Without `accessKey`, it omits `accessKey`, `key`, and `account`. `undefined` when the user has no Tempo ID session, so the app shows its sign-in.

### account

- **Type:** [`TempoAccount.TempoAccount`](types.md#tempoaccount) `| undefined`

The user's Tempo Account that the access key acts for, on the access key's chain, as `POST /v1/authorize` returns it. Absent without `accessKey`, or where Tempo ID returns no accounts. The instance's session holds it, so the app reads no [`Actions.account.get`](Actions.account.get.md) after the call.

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
const result = await Actions.authorize(config, {
  accessKey: {
    account,
    expiry: Expiry.days(1),
    limits: [{ limit: 10_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

### account (optional)

- **Type:** `` `0x${string}` ``
- **Default:** The `access` of `accessKey.account`, or the app's selected account, or the user's oldest

The user's Tempo Account that the access key acts for, in place of the `access` of `accessKey.account`. Only with `accessKey`. It stays the app's account until sign-out, or the next sign-in to the app.

```ts
const result = await Actions.authorize(config, {
  accessKey,
  account: '0x8C3b5d0e2A4f6B1c9D7e3F5a0B2c4D6e8F1a3B5c',
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const result = await Actions.authorize(config, { accessKey, challenge })
```

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the ceremony of the passkey that owns the account, with `passkey`, as in [`Actions.passkey.signIn`](Actions.passkey.signIn.md#getfn-optional).

```ts
const result = await Actions.authorize(config, {
  accessKey,
  getFn: (options) => Passkeys.get(options),
  passkey: true,
})
```

### passkey (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether a passkey that owns the account, such as a wallet.tempo passkey, signs the access key on the page. The passkey's relying party must cover the page's origin. Only with `accessKey`.

```ts
button.onclick = async () => {
  const result = await Actions.authorize(config, { accessKey, passkey: true })
}
```

## Errors

### `Id.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values.

#### Authorization

- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names a Tempo Account that is not the user's.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The request came from an origin other than the redirect URI's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): Tempo ID refused the app or its request, or the user holds no Tempo Account and the app's first realm creates none.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): A passkey owns the Tempo Account, and the call has no `passkey`, the passkey's relying party does not cover the page, or the ceremony failed, with its error as `cause`. Pass `passkey: true`, or authorize through [`Actions.redirect.start`](Actions.redirect.start.md).
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion of the passkey step did not verify, or was spent before.

#### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An app with `tempo-id:sign` has no ceiling.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

#### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.

### `Id.ChallengeWithoutKeyError`

Thrown before any request when the call receives `challenge` without `accessKey`.
