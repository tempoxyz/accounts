# Actions.passkey.register

## Overview

Registers a new passkey for the signed-in user from a first-party app's page, such as right after an emailed-code sign-in. An instance with the [`passkey`](plugins.passkey.md) plugin calls it as `tempoId.passkey.register()`. An app at the page's origin must hold the `tempo-id:sign` scope. The passkey belongs to the `default` realm's relying party, which must cover the page and Tempo ID, as [Registration from an app's page](https://github.com/tempoxyz/id/blob/main/docs/passkeys.md#registration-from-an-apps-page) describes. The action sends these requests:

1. `POST /v1/account/passkey/options` returns the creation options and the proof options. With `registration`, the action skips this request.
2. The authenticator creates the passkey.
3. The new passkey signs the proof challenge.
4. `POST /v1/account/passkey/verify` with the credential and the proof stores the passkey, and returns its credential ID and the address of its account.

After an emailed-code sign-in with `registration: true`, the registration sends only the last request. A server whose options hold no proof options returns a proof step from `POST /v1/account/passkey` after the creation, and the action sends that request too.

The user approves two prompts, so call it from a click. The session must have signed in within the last 10 minutes. With `key`, the passkey joins the access key's cloud-wallet account as a second owner on the access key's chain, through an update that the cloud wallet signs, as [Passkey on a cloud wallet's account](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#passkey-on-a-cloud-wallets-account) describes. The access key keeps working, so a send with it needs no prompt. On a chain whose accounts are not configurable, `key` sets nothing, and the passkey owns an account of its own. `account` and `chain` name the account and chain instead. Without any of them, the passkey owns an account of its own.

## Usage

```ts
import { Actions } from 'accounts'

const authorization = await Actions.email.signIn(config, {
  accessKey,
  code,
  email,
  registration: true,
})
const passkey = await Actions.passkey.register(config, {
  key: authorization.key,
  registration: authorization.registration,
})
// { address: '0x…', id: 'KEbWNCc7NgaYnUyrNeFGX9_3Y-8' }
```

## Return type

### address

- **Type:** `` `0x${string}` ``

The address of the Tempo Account that the passkey owns: `account`, or the passkey's own account on `chain`.

### id

- **Type:** `string`

The credential ID of the passkey, base64url.

## Parameters

### account (optional)

- **Type:** `` `0x${string}` ``
- **Default:** `key.account`, on a chain whose accounts are configurable

A configurable Tempo Account of the user's cloud wallet in the `default` realm, which the passkey joins as a second owner on `chain`. Without it, the passkey owns an account of its own.

```ts
await Actions.passkey.register(config, { account: '0x…', chain: 'testnet' })
```

### chain (optional)

- **Type:** `number | string`
- **Default:** The chain of `key`, when its accounts are configurable, else the first chain whose accounts are configurable for `account`, and the passkey's own address otherwise.

The chain whose accounts are configurable, by its name in `GET /v1/chains`, such as `testnet`, or its ID. It selects where `account` is, and the chain of the returned `address`. Tempo ID refuses an unknown chain with `invalid_field` at the last request, after both ceremonies, and the action signals the browser to drop the passkey.

```ts
await Actions.passkey.register(config, { chain: 'testnet' })
```

### chainId (optional)

- **Type:** `number`

The chain whose accounts are configurable, by its ID, in place of `chain`. The action sends it as `chain`. `chain` wins when both are present.

```ts
await Actions.passkey.register(config, { account: '0x…', chainId: 1337 })
```

### createFn (optional)

- **Type:** `(options: CredentialCreationOptions) => Promise<Credential | null>`

Runs the creation ceremony in place of `navigator.credentials.create`.

```ts
await Actions.passkey.register(config, { createFn, getFn })
```

### getFn (optional)

- **Type:** `(options: CredentialRequestOptions) => Promise<Credential | null>`

Runs the proof ceremony in place of `navigator.credentials.get`.

```ts
await Actions.passkey.register(config, { createFn, getFn })
```

### key (optional)

- **Type:** `Pick<AccessKey.AccessKey, 'account' | 'chainId'>`

The access key of a sign-in on the cloud wallet's account, such as `authorization.key`. The action sends the access key's account and chain ID, and Tempo ID decides: on a chain whose accounts are configurable, the access key sets the default `account` and `chain`. Otherwise it sets neither, and the passkey owns an account of its own. Registration does not sign with the access key.

```ts
await Actions.passkey.register(config, { key: authorization.key })
```

### registration (optional)

- **Type:** `Registration`, from [`Actions.email.signIn`](Actions.email.signIn.md#registration)

The registration options that an emailed-code sign-in returned with `registration: true`. The action uses them in place of the options request while they are younger than 4 minutes, a minute short of their challenge's 5, and no earlier call sent their challenge. Tempo ID spends the challenge at the request that sends it, whether or not the registration succeeds, so a retry after that request requests new options, as for older or absent options.

```ts
await Actions.passkey.register(config, {
  registration: authorization.registration,
})
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses a request, with one of these `reason` values:

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

### `Registration.CreateFailedError`

Thrown, from `ox/webauthn`, when the creation ceremony fails, such as when the user dismisses it. Tempo ID stores nothing.

### `Authentication.SignFailedError`

Thrown, from `ox/webauthn`, when the proof ceremony fails. Tempo ID stores nothing.

After a failed proof, or a verify request that failed before Tempo ID stored the passkey, the action signals the browser to drop the new passkey, with `PublicKeyCredential.signalUnknownCredential` where the browser supports it. A failure after the store, such as `config_conflict` from the owner change, carries the `Tempo-Id-Passkey-Stored: true` header, and the action keeps the passkey. A failure without a `reason`, such as a gateway's, may follow the store, so the action keeps the passkey too.
