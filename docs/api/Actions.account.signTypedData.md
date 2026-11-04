# Actions.account.signTypedData

## Overview

Signs EIP-712 typed data as the user's configurable Tempo Account, with the user's cloud wallet as the owner. On a page, `tempoId.signTypedData` calls it through the account of the [`viem`](plugins.viem.md) plugin's client, until the chain holds the session's access key. The action sends `POST /v1/account/sign-typed-data` with the session cookie, and returns the account's signature.

Tempo ID derives the typed data's EIP-712 hash itself, never taking a digest, so the signature authorizes no transaction and no access key. A contract that accepts the account's signature of the typed data acts on it. [Message signing](https://github.com/tempoxyz/id/blob/main/docs/configurable-accounts.md#message-signing) describes the flow and its rules. Call it from the page of a first-party app with the `tempo-id:sign` scope.

## Usage

```ts
import { Actions } from 'accounts'

const signature = await Actions.account.signTypedData(config, {
  account: tempoAccount.address,
  chain: 'devnet',
  typedData: {
    domain: { name: 'App', version: '1', chainId: 31318 },
    message: { amount: 1_000_000n },
    primaryType: 'Order',
    types: { Order: [{ name: 'amount', type: 'uint256' }] },
  },
})
// '0x05f8…'
```

## Return type

`` `0x${string}` ``

The account's configurable signature envelope (TIP-1107), serialized. The signature verifier precompile's `verifyConfigurableAccount` accepts it for `hashTypedData(typedData)`, as Viem's `Actions.accounts.verifyHash` calls it.

## Parameters

### account

- **Type:** `` `0x${string}` ``

The address of the user's Tempo Account on `chain`, which the user's cloud wallet owns.

```ts
await Actions.account.signTypedData(config, { account: '0x…', typedData })
```

### chain (optional)

- **Type:** `number | string`
- **Default:** The first chain whose accounts are configurable.

The chain whose configuration of the account signs, by its name in `GET /v1/chains`, such as `devnet`, or its ID.

```ts
await Actions.account.signTypedData(config, {
  account: '0x…',
  chain: 'devnet',
  typedData,
})
```

### typedData

- **Type:** `TypedDataDefinition`, from `viem`

The typed data, as Viem's `signTypedData` takes it: `domain`, `types`, `primaryType`, and `message`. Each bigint travels as its decimal string, which the hash reads as the same integer.

```ts
await Actions.account.signTypedData(config, {
  account: '0x…',
  typedData: {
    domain: { name: 'App' },
    message: { body: 'Hello' },
    primaryType: 'Mail',
    types: { Mail: [{ name: 'body', type: 'string' }] },
  },
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
- [`invalid_field`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#invalid_field): `typedData` does not hash as EIP-712 typed data, such as a message that does not match its `types`.
- [`config_conflict`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#config_conflict): The chain holds a configuration that Tempo ID did not send.
- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The user exceeded the limit of account requests. Retry after `Retry-After` seconds.
- [`upstream_unavailable`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#upstream_unavailable): The chain or the cloud wallet's provider failed. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.
