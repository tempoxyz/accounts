# email

## Overview

The plugin of sign-in with an emailed code, which adds `accounts.email.sendCode` and `accounts.email.signIn`. An app renders its own form, and Tempo ID emails a 6-digit code to the address. On a page, only a [first-party app](https://github.com/tempoxyz/id/blob/main/docs/apps.md#first-party-apps) signs in this way, at the origin of one of its redirect URIs, and the access key must fit the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), unless the app holds `tempo-id:sign`.

On an instance with `clientSecret` or `clientAssertion`, which only a backend holds, the plugin calls the backend's routes instead, as [Backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md) describes. A backend's instance holds no session, so it saves the result with [`backend.save`](plugins.backend.md#backendsave).

## Usage

```ts
import { Accounts } from 'accounts'
import { email } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [email()] })

await accounts.email.sendCode({ email: 'user@example.com' })
const session = await accounts.email.signIn({
  code: '123456',
  email: 'user@example.com',
})
```

## Return type

`Plugin<'email', { sendCode, signIn }>`

### email.sendCode

- **Type:** `(parameters: { email: string; userIp?: string }) => Promise<void>`

Emails a sign-in code to `email`. The response is the same for every address, so it reveals no account. On a backend, `userIp` is the end user's IP address, which rate limits count in place of the backend's.

```ts
await accounts.email.sendCode({ email: 'user@example.com' })
```

### email.signIn

- **Type:** `(parameters: email.signIn.Parameters) => Promise<Session & { accounts: readonly TempoAccount[]; upgradeAvailable: boolean }>`

Signs the user in with the emailed code, sets the instance's [session](types.md#session), and returns it. With `accessKey`, the session holds an access key. On a page, the session holds the user's Tempo Account from the sign-in's own response, with no request after it. A chain that Tempo ID does not list leaves the account out. `upgradeAvailable` is `true` for a wallet.tempo passkey's account that waits for its [upgrade](Accounts.create.md#accountupgrade).

`accounts` lists every [Tempo Account](types.md#tempoaccount) of the user in the app's realms, from the same response: the session's account first, then oldest first. It is empty on a backend, and where the session holds no account. The access key acts for the first account. If the list holds more than one, ask the user, then call [`authorize`](Accounts.create.md#authorize) with the chosen `account`.

```ts
const session = await accounts.email.signIn({ code, email: address })
if (session.accounts.length > 1) {
  const [, other] = session.accounts
  await accounts.authorize({ account: other!.address, passkey: true })
}
```

## Parameters

### getFn (optional)

- **Type:** `Authentication.sign.Options['getFn']`, from `ox/webauthn`
- **Default:** `navigator.credentials.get`

Runs the ceremony of the passkey that a sign-in's `link` names, or of the passkey that owns the account, in place of `navigator.credentials.get`.

```ts
const accounts = Accounts.create({
  plugins: [email({ getFn: (options) => Passkeys.get(options) })],
})
```

### email.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
const session = await accounts.email.signIn({
  accessKey: false,
  code,
  email: address,
})
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes. It needs the `tempo-id:sign` scope and an access key.

```ts
const session = await accounts.email.signIn({ challenge, code, email: address })
```

#### code

- **Type:** `string`

The 6-digit code that Tempo ID emailed.

```ts
const session = await accounts.email.signIn({ code: '123456', email: address })
```

#### email

- **Type:** `string`

The address that received the code.

```ts
const session = await accounts.email.signIn({ code, email: 'user@example.com' })
```

#### link (optional)

- **Type:** `string`

The `link` from the email step of [`passkey.signIn`](plugins.passkey.md#passkeysignin), which links that passkey to the user. The call first runs the passkey's ceremony. If the ceremony fails or the link expires, the code stays valid, so call again without `link`.

```ts
const session = await accounts.email.signIn({
  code,
  email: address,
  link: step.link,
})
```

#### userIp (optional)

- **Type:** `string`

The end user's IP address, which rate limits count. Only a backend sends it.

```ts
const session = await accounts.email.signIn({
  code,
  email: address,
  userIp: c.req.header('cf-connecting-ip'),
})
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses a request, with its `reason`. A refusal after the sign-in has `signedIn: true`, and empties the session.

#### email.sendCode

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): A field is missing or malformed.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request or the email service exceeded a rate limit. Retry later.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The email service refused the code. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### email.signIn

##### Sign-in

After a refusal of a `link`, the code stays valid, so call again without `link`.

- [`invalid_code`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_code): The code is wrong or expired.
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The address has no user, and its domain is not one of the deployment's [sign-up domains](https://github.com/tempoxyz/id/blob/main/docs/authentication.md#sign-up-domains). Sign in with an existing account, or with an address at one of those domains.
- [`passkey_link_expired`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_link_expired): The `link` expired, or the browser holds no link cookie for it.
- [`passkey_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#passkey_not_permitted): The passkey's relying party does not cover the app's realms or page.
- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): With `link`, the page's origin is no redirect URI's origin.
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion of the passkey that `link` names did not verify.

##### Authorization request

Tempo ID checks the authorization request before the code, so the code stays valid, and the error's [`signedIn`](Accounts.RequestError.md#signedin) is `false`.

- [`invalid_origin`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_origin): The request came from an origin other than the redirect URI's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): Tempo ID refused the app or its request.
- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/errors.md#headless-ceiling). An app with `tempo-id:sign` has no ceiling.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.

##### Authorization

The user is signed in, and the error's [`signedIn`](Accounts.RequestError.md#signedin) is `true`.

- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names a Tempo Account that is not the user's.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): The user holds no Tempo Account, and the app's first realm creates none.
- [`upgrade_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upgrade_required): The call cannot run a passkey ceremony, and the access key waits for a wallet.tempo passkey's upgrade. For a user without an account, `meta.credentialId` names the email's passkey.
- [`session_changed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_changed): Only from a server that returns no authorization with the sign-in. Another sign-in replaced the session after this one verified. Sign in again.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): A passkey owns the Tempo Account, and the call cannot run its ceremony: there is no browser or `getFn`, the passkey's relying party does not cover the page, or the ceremony failed, such as when the user dismisses the prompt. Sign in through [`redirect.signIn`](plugins.redirect.md#redirectsignin).
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion of the passkey step did not verify, or was spent before.

##### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.

#### On a backend

`email.sendCode` throws one of these `reason` values:

- [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client): The instance has no `clientSecret` or `clientAssertion`, the app is unknown or disabled, or its secret or keys refuse the request. Without either, the call throws before any request, with `status` 0.
- [`backend_sign_in_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#backend_sign_in_not_permitted): The app has no client secret or keys, or does not hold backend sign-in.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): A field is missing or malformed, such as `userIp`.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request or the email service exceeded a rate limit. Retry later.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The email service refused the code. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

`email.signIn` throws one of these:

##### Sign-in

- [`invalid_code`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_code): The code is wrong, expired, or used, or the address has no code. Request a new code.
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The verified address has no user, and its domain is not a sign-up domain.
- [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client): The instance has no `clientSecret` or `clientAssertion`, the app is unknown or disabled, or its secret or keys refuse the request.
- [`backend_sign_in_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#backend_sign_in_not_permitted): The app has no client secret or keys, or does not hold backend sign-in.

##### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the headless ceiling.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names an account that is not the user's.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): A passkey owns the access key's account, and no page signs its access key.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): No account can sign the access key, or the app has no redirect URI.

##### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.

### `Authentication.SignFailedError`

Thrown, from `ox/webauthn`, when the ceremony of the passkey that `link` names fails. The code stays valid. A failed ceremony of the passkey step comes after the sign-in, so it throws `webauthn_required` with `signedIn: true` instead, with the ceremony's error as `cause`.

### `Accounts.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.

### `Accounts.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
