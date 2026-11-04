# Error classes

## Overview

Each module throws its own error classes beside [`Accounts.RequestError`](Accounts.RequestError.md), the error of every refused request. Each class's `name` is its namespaced form, such as `Accounts.KeyRequiredError`, and its `message` states the fault and the fix. Each API page lists, under Errors, the classes that its function throws.

## Usage

```ts
import { Accounts } from 'accounts'

const session = await accounts.email
  .signIn({ code, email: address })
  .catch((error: unknown) => {
    // A newer sign-in or a sign-out completed first, and the instance kept its result.
    if (error instanceof Accounts.SupersededError) return undefined
    throw error
  })
```

## Accounts

### `Accounts.ChainUnavailableError`

Thrown when the account of a [`viem`](plugins.viem.md) client signs a message or typed data on a chain that Tempo ID does not list. Sign in with an access key on a listed chain.

### `Accounts.ChallengeWithoutKeyError`

Thrown before any request when a sign-in receives `challenge` without `accessKey`. A challenge rides in the key authorization, so a sign-in without an access key takes none.

### `Accounts.ClientIdRequiredError`

Thrown by [`Accounts.create`](Accounts.create.md) and [`Accounts.from`](Accounts.from.md) outside a browser without `clientId`, where no page's origin can serve as one.

### `Accounts.EverywhereNotAllowedError`

Thrown by [`signOut`](Accounts.create.md#signout) with `everywhere` from an app that is not first-party, such as an app whose client ID is an origin, a metadata document's URL, an `app_` ID, or a `cli:` name. The call signs nothing out. Sign out without `everywhere`.

### `Accounts.KeyRequiredError`

Thrown when a sign-in without an access key cannot serve the call: [`device.signIn`](plugins.device.md) without `accessKey`, since the device grant always requests an access key, a transaction from the account of a [`viem`](plugins.viem.md) client whose session holds no access key, and `accounts.viem({ session })` for a session without an access key.

### `Accounts.PendingNotFoundError`

Thrown by [`backend.complete`](plugins.backend.md#backendcomplete) without a redirect in progress for the session ID, such as for a callback that arrived twice, or more than 10 minutes after `start`. Start the sign-in again.

### `Accounts.SignedOutError`

Thrown when the account of a [`viem`](plugins.viem.md) client is read while the instance holds no session, such as by a transaction before the sign-in. Sign in before sending.

### `Accounts.SupersededError`

Thrown by a sign-in that another sign-in or a sign-out overtook. The instance keeps the newer session, and never returns the overtaken result. A sign-in that a sign-out overtook ends the Tempo ID session that it set again.

## Actions

### `Actions.dialog.BlockedError`

Thrown by [`dialog.signIn`](plugins.dialog.md#dialogsignin) when the browser blocks the popup, since the call ran outside a user gesture such as a click.

### `Actions.dialog.OriginError`

Thrown by [`dialog.signIn`](plugins.dialog.md#dialogsignin) when the redirect URI is on another origin than the page, so its callback page cannot reach the page that called `signIn`.

## mpp

### `mpp.MaxAmountError`

Thrown by a payment of [`accounts.fetch` or `accounts.mpp`](mpp.mpp.md) whose charge costs more than `maxAmount`. The access key signs nothing. Raise `maxAmount` to pay it.

### `mpp.MaxAmountPrecisionError`

Thrown by a payment of [`accounts.fetch` or `accounts.mpp`](mpp.mpp.md) whose `maxAmount` names more than 6 decimals, which a TIP-20 token cannot hold. The access key signs nothing. Round `maxAmount` to 6 decimals.

## wagmi

### `wagmi.AccountUnavailableError`

Thrown by the `connect` of [`tempoId`](wagmi.tempoId.md) when the session holds no access key, and Tempo ID returned no Tempo Account for the app.

### `wagmi.ChainSwitchError`

Thrown by the `switchChain` of [`tempoId`](wagmi.tempoId.md), and by its `connect` with `chainId`, for a chain other than the connector's. Put the chain first in the config's `chains`.

### `wagmi.SignInIncompleteError`

Thrown by the `connect` of [`tempoId`](wagmi.tempoId.md) when the sign-in set no session, such as a redirect that left the page.

### `wagmi.SignInRequiredError`

Thrown by the `connect` of [`tempoId`](wagmi.tempoId.md) without `signIn` when each sign-in plugin of the instance takes input, such as `email`. Pass `signIn`.

## Other modules

### `AccessToken.InvalidError`

Thrown by `verifyHash`, `verifyMessage`, and `verifyTypedData` of the [`viem`](plugins.viem.md) plugin for an `accessToken` that does not verify, or names an app that the verifier does not allow.

### `Permissions.DecimalsUnknownError`

Thrown by [`Permissions.resolve`](Permissions.resolve.md), and by each sign-in, for a decimal `limit` on a token that the chain does not list.

### `Permissions.InvalidDurationError`

Thrown by [`Permissions.resolve`](Permissions.resolve.md), and by each sign-in, for a duration that is not a whole number and one of the units `s`, `m`, `h`, `d`, or `w`, such as `'1d'`.

### `Permissions.LimitPrecisionError`

Thrown by [`Permissions.resolve`](Permissions.resolve.md), and by each sign-in, for a decimal `limit` with more fractional digits than its token's decimals.

### `Permissions.TokenUnknownError`

Thrown by [`Permissions.resolve`](Permissions.resolve.md), and by each sign-in, for a token symbol that the chain does not list.

### `Plugins.viem.RetryAccountError`

Thrown by a transaction of the [`viem`](plugins.viem.md#pluginsviemretryaccounterror) plugin's client when the sign-in of its [retry](plugins.viem.md#retry-optional) returns another user or Tempo Account. Match it by `name`.

### `Plugins.viem.RetryClosedError`

Thrown by a transaction of the [`viem`](plugins.viem.md#pluginsviemretryclosederror) plugin's client when the user closes the screen of its [retry](plugins.viem.md#retry-optional). Its `kind` names the failure, and its `cause` is the transaction's error. Match it by `name`.
