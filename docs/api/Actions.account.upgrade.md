# Actions.account.upgrade

## Overview

Upgrades a wallet.tempo passkey's Tempo Account in place to a configurable account, from the app's page, with no redirect. Call it when a sign-in or `Actions.authorize` returns `upgradeAvailable: true`. An instance's [`tempoId.account.upgrade()`](Accounts.create.md#accountupgrade) passes the access key of its session, and sets the session's account to the upgraded account. The account keeps its address. The passkey stays its only owner, unless `addOwner` adds the user's Privy wallet in the same transaction. The passkey signs once. The action sends these requests:

1. `POST /v1/account/upgrade` returns the passkey step. With `key`, the step also holds the digest of the access key's registration.
2. The passkey signs the step's challenge. The access key signs the registration's digest raw, with no prompt.
3. `POST /v1/account/upgrade` again, with both signatures. Tempo ID registers the access key through a transaction that its sponsor pays, then sends the upgrade.

The chain registers the access key before the upgrade, so the access key keeps working. [Upgrade from an app's page](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#upgrade-from-an-apps-page) describes the flow. The page must be one that the passkey's relying party covers, and the session must have signed in within the last 10 minutes.

## Usage

```ts
import { Actions } from 'accounts'

const result = await Actions.passkey.signIn(config, { accessKey })
if (!('step' in result) && result.upgradeAvailable) {
  const account = await Actions.account.upgrade(config, { key: result.key })
  // account.config.version: 1n, account.keys: [{ address: '0x…', credential: { id, publicKey, rpId }, type: 'webAuthn' }]
}
```

## Return type

[`TempoAccount.TempoAccount`](types.md#tempoaccount)

The upgraded account, at the same address.

## Parameters

### accessKey (optional)

- **Type:** `Account.Account`, from `viem/tempo`

The app's own access key that the app supplied to the sign-in as `accessKey.account`, which signs the registration for a `key` without material.

```ts
await Actions.account.upgrade(config, {
  accessKey: account,
  key: authorization.key,
})
```

### addOwner (optional)

- **Type:** `'privy'`

The owner that the upgrade adds beside the passkey, at threshold 1. `privy` adds the user's Privy wallet, which Tempo ID creates when the user holds none. An emailed-code sign-in then reaches the account, and the Privy wallet signs its access keys without the passkey. For an account that upgraded with its passkey as the only owner, the passkey signs an update that adds the Privy wallet, and `key` is not needed. [Cloud wallet on an upgraded account](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#cloud-wallet-on-an-upgraded-account) describes the flow. Absent, the passkey stays the only owner.

```ts
await Actions.account.upgrade(config, {
  addOwner: 'privy',
  key: authorization.key,
})
```

### account (optional)

- **Type:** `` `0x${string}` ``
- **Default:** `key.account`

The account to upgrade.

```ts
await Actions.account.upgrade(config, { account: '0x…' })
```

### chain (optional)

- **Type:** `number | string`
- **Default:** The chain of `key`, or the first chain whose accounts are configurable.

The chain to upgrade on, by its name in `GET /v1/chains`, such as `testnet`, or its ID. Tempo ID refuses an unknown chain with `invalid_field` before the passkey's prompt.

```ts
await Actions.account.upgrade(config, { account: '0x…', chain: 'local' })
```

### chainId (optional)

- **Type:** `number`

The chain to upgrade on, by its ID, in place of `chain`. The action sends it as `chain`. `chain` wins when both are present.

```ts
await Actions.account.upgrade(config, { account: '0x…', chainId: 1337 })
```

### getFn (optional)

- **Type:** `(options: CredentialRequestOptions) => Promise<Credential | null>`

Runs the WebAuthn ceremony in place of `navigator.credentials.get`.

```ts
await Actions.account.upgrade(config, { getFn, key: authorization.key })
```

### key (optional)

- **Type:** [`AccessKey.AccessKey`](types.md#accesskey)

The access key of an authorization with `upgradeAvailable: true`, which the chain registers before the upgrade. Without it, an access key that the passkey signed as its own account stops working after the upgrade.

```ts
await Actions.account.upgrade(config, { key: authorization.key })
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses a request, with one of these `reason` values:

- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID.
- [`reauthentication_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#reauthentication_required): The session signed in more than 10 minutes before. Sign in again.
- [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled): The chain's accounts are not configurable.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The account is not the user's in the app's realms.
- [`not_configurable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#not_configurable): No passkey owns the account, such as a cloud wallet's.
- [`origin_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#origin_required): The request carries no `Origin`, such as from outside a browser, so it does not prove the app of `clientId`. Call the action from a page at a redirect URI of the app.
- [`owner_exists`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#owner_exists): The account is configurable already. With `addOwner`, the account holds a cloud wallet already.
- [`owner_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#owner_unavailable): With `addOwner`, the user's Privy wallet holds at least 1 USD on its own account, or owns another account, or the realm creates none.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): The account's passkey did not sign `key`, the access key expired, no scope of the access key allows a TIP-20 transfer of 0 that registers it, or the account upgraded before the chain registered the access key.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): The passkey's relying party does not cover the page.
- [`webauthn_rejected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_rejected): The assertion does not verify, or its step expired. Run the action again.
- [`config_conflict`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#config_conflict): The chain holds a configuration that Tempo ID did not send.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account changes. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the sponsor refused or failed a transaction. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
