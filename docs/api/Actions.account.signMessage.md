# Actions.account.signMessage

## Overview

Signs a message as the user's configurable Tempo Account, with the user's cloud wallet as the owner. On a page, the account of the [`viem`](plugins.viem.md) plugin's client signs messages with it until the chain holds the session's access key, so `tempoId.signMessage` calls it. The action sends `POST /v1/account/sign-message` with the session cookie, and returns the account's signature.

Tempo ID signs the message's EIP-191 hash, never a raw digest, so the signature authorizes no transaction and no access key. [Message signing](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#message-signing) describes the flow and its rules. Call it from the page of a first-party app with the `tempo-id:sign` scope. A passkey owner of the account signs in the browser, without this action.

## Usage

```ts
import { Actions } from 'accounts/internal'

const account = await Actions.account.get(config, { chain: 'devnet' })
const signature = await Actions.account.signMessage(config, {
  account: account!.address,
  chain: 'devnet',
  message: 'Sign in to app.example.com',
})
// '0x05f8…'
```

## Return type

`` `0x${string}` ``

The account's configurable signature envelope (TIP-1107), serialized. The signature verifier precompile's `verifyConfigurableAccount` accepts it for the EIP-191 hash of `message`, as Viem's `Actions.accounts.verifyHash` calls it.

## Parameters

### account

- **Type:** `` `0x${string}` ``

The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns.

```ts
await Actions.account.signMessage(config, { account: '0x…', message: 'Hello' })
```

### chain (optional)

- **Type:** `number | string`
- **Default:** The first chain whose accounts are configurable.

The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as `devnet`, or its ID.

```ts
await Actions.account.signMessage(config, {
  account: '0x…',
  chain: 'devnet',
  message: 'Hello',
})
```

### message

- **Type:** ``string | { raw: `0x${string}` | Uint8Array }``

The message, as UTF-8 text, or as raw bytes or hex, as Viem's `SignableMessage` takes it. Tempo ID accepts at most 16,384 characters of text, or 16,384 bytes.

```ts
await Actions.account.signMessage(config, {
  account: '0x…',
  message: { raw: '0x48656c6c6f' },
})
```

## Errors

### `Accounts.RequestError`

Thrown when Tempo ID refuses the request, with one of these `reason` values:

- [`sign_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#sign_not_permitted): The page is not the page of a first-party app with the `tempo-id:sign` scope, or `clientId` names another app.
- [`session_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#session_required): The user is not signed in to Tempo ID.
- [`configurable_accounts_disabled`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#configurable_accounts_disabled): The chain's accounts are not configurable.
- [`foreign_account`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#foreign_account): The account is not the user's in the app's realms.
- [`webauthn_required`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#webauthn_required): No cloud wallet of the user owns the account on the chain. Sign with the account's passkey.
- [`config_conflict`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#config_conflict): The chain holds a configuration that Tempo ID did not send.
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): `message` is empty or too long, or `account` is not an address.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account requests. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the cloud wallet's provider failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
