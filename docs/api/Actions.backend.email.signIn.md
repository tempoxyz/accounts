# Actions.backend.email.signIn

## Overview

Signs the user in with an emailed code from the app's backend, with the email code grant of `POST /oauth2/token` and the app's client secret or [client assertion](https://github.com/tempoxyz/id/blob/main/docs/apps.md#client-assertions). The app's own UI collects the email and the code, and the backend receives the authorization. No browser or cookie takes part, as [Backend sign-in](https://github.com/tempoxyz/id/blob/main/docs/backend-sign-in.md) describes.

The first sign-in of an address creates the user. Each sign-in, with or without an access key, creates the user's first Tempo Account in the app's first realm if the user holds none. The access key must fit the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

## Usage

```ts
import { Actions, Id } from 'accounts'
import { Expiry, Scopes } from 'viem/tempo'

const config = Id.from({
  clientId: process.env.CLIENT_ID!,
  clientSecret: process.env.CLIENT_SECRET!,
})

// An access key that may transfer up to 10 OUSD for a day.
const accessKey = {
  expiry: Expiry.days(1),
  limits: [{ limit: 10_000_000n, token: ousd }],
  scopes: [Scopes.tip20(ousd).transfer()],
}
const authorization = await Actions.backend.email.signIn(config, {
  accessKey,
  code: '123456',
  email: 'user@example.com',
  userIp: '203.0.113.7',
})
```

## Return type

- **Type:** [`Authorization.Authorization`](types.md#authorization), or [`Tokens`](types.md#tokens) with `user` without `accessKey`

The user's tokens, the access key, and the user. Without `accessKey`, the tokens and the user, without `accessKey` and `key`.

## Parameters

### code

- **Type:** `string`

The 6-digit code that Tempo ID emailed.

```ts
await Actions.backend.email.signIn(config, { code: '123456', email })
```

### email

- **Type:** `string`

The address that received the code.

```ts
await Actions.backend.email.signIn(config, { code, email: 'user@example.com' })
```

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`. Without it, the call authorizes no access key, and takes no `challenge`. The action sends the fields as given. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). The access key names its `limits` and `scopes`, within the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling), or Tempo ID refuses it.

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`, such as the public key of an access key that the app's UI holds. Its `access` names the Tempo Account, which defaults to the app's selected account, or the user's oldest. It defaults to a new secp256k1 access key. Without `account`, `publicKey` and `type` name an access key whose private key the page does not hold, such as one on the app's server, and `type` defaults to `secp256k1`. The result's `accessKey` then rejects each signature with `AccessKey.AccessKeyRequiredError`.

```ts
const authorization = await Actions.backend.email.signIn(config, {
  accessKey: {
    account: Account.fromSecp256k1(privateKey),
    expiry: Expiry.days(30),
    limits: [{ limit: 100_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
  code,
  email,
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope and `accessKey`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
await Actions.backend.email.signIn(config, {
  accessKey,
  challenge,
  code,
  email,
})
```

### userIp (optional)

- **Type:** `string`

The end user's IP address, which rate limits count in place of the backend's.

```ts
await Actions.backend.email.signIn(config, { code, email, userIp })
```

## Errors

### `Id.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.

### `Id.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values.

#### Sign-in

- [`invalid_code`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_code): The code is wrong, expired, or used, or the address has no code. Request a new code.
- [`sign_up_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_up_not_permitted): The verified address has no user, and its domain is not a sign-up domain.
- [`invalid_client`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_client): The instance has no `clientSecret` or `clientAssertion`, the app is unknown or disabled, or its secret or keys refuse the request.
- [`backend_sign_in_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#backend_sign_in_not_permitted): The app has no client secret or keys, or does not hold backend sign-in.

#### Access keys

- **Key rules:** [`invalid_chain`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_chain), [`missing_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_key), [`missing_permissions`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_permissions), [`invalid_public_key`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_public_key), [`invalid_expiry`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_expiry), [`expiry_passed`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_passed), [`empty_limits`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_limits), [`empty_scopes`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#empty_scopes), [`duplicate_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_limit), [`unsupported_token`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_token), [`invalid_period`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_period), [`scope_without_limit`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#scope_without_limit), [`missing_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#missing_recipients), [`unsupported_call`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unsupported_call), [`duplicate_scope`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#duplicate_scope), [`invalid_recipients`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_recipients). The access key breaks a [key rule](https://github.com/tempoxyz/id/blob/main/docs/errors.md#access-key-rules).
- **Headless ceiling:** [`expiry_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#expiry_exceeds_maximum), [`limit_exceeds_maximum`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#limit_exceeds_maximum). The access key exceeds the headless ceiling.
- [`challenge_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#challenge_not_permitted): The app sent a `challenge` without the `tempo-id:sign` scope.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The access key names an account that is not the user's.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): A passkey owns the access key's account, and no page signs its access key.
- [`rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rejected): No account can sign the access key, or the app has no redirect URI.

#### Requests

- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field), [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited), [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable), [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): A field is missing or malformed, or a retry later may succeed.
