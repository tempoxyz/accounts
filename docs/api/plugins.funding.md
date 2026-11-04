# funding

## Overview

The plugin of Tempo ID's deposit page, which adds `accounts.funding.open` and `accounts.funding.complete`. Every instance holds it with its default options, so an app passes it only to set them. `open` opens the deposit page for the session's Tempo Account, in a popup or through a redirect. The page returns to one of the app's registered redirect URIs, as [Deposit page of an app](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-page-of-an-app) describes.

The plugin needs a browser page, for the popup or the redirect.

## Usage

```ts
import { Accounts } from 'accounts'

const accounts = Accounts.create({ redirectUri: 'https://app.example/' })

button.addEventListener('click', async () => {
  const result = await accounts.funding.open({ amount: '10', currency: 'USD' })
  if (result?.status === 'received') await refreshBalance()
})
```

## Return type

`Plugin<'funding', { complete, open }>`

### funding.complete

- **Type:** `(parameters?: { redirectUri?: string; url?: string | URL }) => { amount?: string; status: 'continued' | 'received' } | undefined`

Returns the result of the deposit page that `open` opened with `mode: 'redirect'`, on the redirect URI's page. Without `url`, it reads the page's URL, and removes the result from the address bar.

```ts
const result = accounts.funding.complete()
```

### funding.open

- **Type:** `(parameters?: funding.open.Parameters) => Promise<{ amount?: string; status: 'closed' | 'continued' | 'received' } | undefined>`

Opens the deposit page, and returns its result, or `undefined` in `redirect` mode. Call it in a user gesture, such as a click. `address` defaults to the session's account, else to the access key's account, on the instance's chain. Otherwise, after the popup opens, `open` loads the stored session and reads the account on the call's chain with a live access token, which it refreshes when it expires within 30 seconds. A popup that the user closes before the address loads returns `closed`.

```ts
const result = await accounts.funding.open({ amount: '10', token: 'USDC.e' })
```

#### amount

- **Type:** `string | undefined`

The USD value that the deposit page saw the account receive, or the confirmed amount of a Buy MACH purchase, as a decimal string, such as `25.500000`. Present only for `received`, and absent for a deposit that the page could not value, such as a faucet deposit on a chain whose balance does not load.

#### status

- **Type:** `'closed' | 'continued' | 'received'`

`received` when **Done** on a receive screen saw a deposit arrive, after a confirmed Buy MACH purchase, or after the faucet of a test chain funded the account. `continued` when the user selected **Continue to** the app without a deposit, which only a tab offers. `closed` when the user closed the popup, such as before a transfer from another network lands, or selected **Cancel** in the page's dialog.

## Parameters

### mode (optional)

- **Type:** `'frame' | 'popup' | 'redirect'`
- **Default:** `'frame'`

Where every `open` opens the deposit page, unless the call passes `mode`.

```ts
import { funding } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [funding({ mode: 'redirect' })] })
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin with `/`

The registered redirect URI that the deposit page returns to, unless the call passes `redirectUri`.

```ts
const accounts = Accounts.create({
  plugins: [funding({ redirectUri: 'https://app.example/wallet' })],
})
```

### funding.open parameters

#### address (optional)

- **Type:** `` `0x${string}` | Promise<`0x${string}`> | (() => Promise<`0x${string}`>) ``
- **Default:** The session's Tempo Account, else the access key's account

The Tempo Account that receives the deposit. It must be one of the signed-in user's accounts in the `default` realm, or the page shows that it found no wallet. A promise, such as a read of the account, resolves after the popup opens, so the popup still opens within the gesture. A function that returns one runs only after the other parameters pass their checks and the popup opens, so a refused call starts no read.

```ts
const result = await accounts.funding.open({ address })
```

#### amount (optional)

- **Type:** `string`

The amount that the app needs, as a decimal string. With `currency` and `token`, it selects the methods that the page lists, as [Deposit methods](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-methods) describes. Tempo ID checks the hint against the listed tokens of the deposit's chain. Without it, or for a hint that Tempo ID refuses, the page lists every method.

```ts
const result = await accounts.funding.open({ amount: '20' })
```

#### chainId (optional)

- **Type:** `number`
- **Default:** The instance's `chainId`

The chain of the deposit. The page's `chain` parameter names Tempo mainnet and Tempo testnet as `mainnet` and `testnet`, and another chain by its ID. On a chain whose faucet funds accounts, such as Tempo testnet, the page offers the faucet first, and a successful faucet deposit returns `received`.

```ts
const result = await accounts.funding.open({ chainId: 42431 })
```

#### currency (optional)

- **Type:** `string`
- **Default:** The currency of `token`, or `USD`

The ISO 4217 currency of `amount`, such as `EUR`. Every listed token of the currency counts. It needs `amount`.

```ts
const result = await accounts.funding.open({
  amount: '20',
  currency: 'EUR',
})
```

#### mode (optional)

- **Type:** `'frame' | 'popup' | 'redirect'`
- **Default:** `'frame'`

Where the deposit page opens: a frame in a dialog on the page, a popup window, or the same tab through a redirect. A page that runs Coinflow where no frame can opens `frame` in a popup: Buy MACH for a hint of `MACH` on Tempo mainnet, on iOS and iPadOS, since Apple Pay runs only on a top-level page. Coinflow's purchase protection does not run in a cross-site frame, so a third-party app's frame shows Buy MACH's amount step, and **Pay by card** continues in a popup from that click.

```ts
await accounts.funding.open({ mode: 'redirect' })
```

#### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin

One of the app's registered redirect URIs, which the page returns to. In `popup` mode, it is on the page's origin. The page offers no way back to the app for a redirect URI that the app did not register.

```ts
const result = await accounts.funding.open({
  redirectUri: 'https://app.example/',
})
```

#### signal (optional)

- **Type:** `AbortSignal`

Rejects the call with the signal's reason, and closes the popup.

```ts
const result = await accounts.funding.open({
  signal: AbortSignal.timeout(600_000),
})
```

#### token (optional)

- **Type:** `string`

The symbol or address of the only token that counts toward `amount`, such as `USDC.e`. Its currency must equal `currency`. It needs `amount`. On Tempo mainnet, `MACH` opens Buy MACH with `amount` in place of the list of methods.

```ts
const result = await accounts.funding.open({
  amount: '10',
  token: 'USDC.e',
})
```

## Errors

### `Plugins.funding.SignedOutError`

Thrown by `open` when the instance holds no session, or the session's account read returns none. Sign the user in first.

### `Actions.funding.BlockedError`

Thrown in `popup` mode when the browser blocks the popup, such as for a call outside a user gesture, or after an `await` in the click handler. Call `funding.open` first in the handler, or pass `mode: 'redirect'`.

### `Actions.funding.OriginError`

Thrown in `popup` mode before the popup opens, when the redirect URI is not on the page's origin. Call `open` on a page of the redirect URI's origin, or pass `mode: 'redirect'`.

### `signal.reason`

Thrown when `signal` aborts, such as a `TimeoutError` from `AbortSignal.timeout`.
