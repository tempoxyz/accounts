# Actions.funding.open

## Overview

Opens Tempo ID's deposit page for one of the signed-in user's Tempo Accounts, from the app's page after the sign-in. An instance calls it through [`tempoId.funding.open`](plugins.funding.md#fundingopen), which reads the account from the session. The page lists the deposit methods, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-methods) describes, and offers **Continue to** the app on each screen of a tab. A popup offers none: it returns to the app once **Done** on a receive screen reads the deposit, and the window's close returns without one. **Continue to** the app returns to one of the app's registered redirect URIs through `GET /i/funding/return`, as [Deposit page of an app](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-page-of-an-app) describes. `mode` selects where the page opens:

| `mode`           | Where                                                                                                                         | Result                                                                                                                             |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `popup`          | A popup window, with `display=popup`                                                                                          | Resolves when the user continues to the app, or closes the popup                                                                   |
| `frame`, default | A frame of `/embed/deposit` in a dialog on the app's page. A page that runs Coinflow where no frame can opens a popup instead | Resolves when the user continues to the app, or closes the dialog                                                                  |
| `redirect`       | The same tab, which returns to the app                                                                                        | Resolves with `undefined`. The redirect URI's page reads the result with [`Actions.funding.complete`](Actions.funding.complete.md) |

Call it in a user gesture, such as a click. In `frame` mode, a call that opens a popup outside a gesture shows a dialog that offers **Continue**, whose click opens the popup. The popup opens before the first `await`, since a popup blocker accepts `window.open` only within the gesture. In `popup` mode, the page must be on the redirect URI's origin, since Tempo ID posts the return only to that origin. The popup closes when the call settles.

In `frame` mode, Tempo ID frames the page for any enabled web app, from the origin of the redirect URI, as [Deposit pages in a frame](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-pages-in-a-frame) describes. A frame that shows no deposit page, such as one that Tempo ID refuses, one without a Tempo ID session, or one that the app's page covers, shows **Continue** in the dialog, which opens the popup in the user's click. **Cancel**, the Escape key, and a click on the backdrop close the dialog, and the call resolves with `closed`.

While the popup is open, a modal dialog on the app's page states **Continue in the Tempo ID window.** It blocks input to the page. **Show window** and a click on the backdrop focus the popup, which a browser can refuse to raise above the page. **Cancel** and the Escape key close the popup, and the call resolves with `closed`. The dialog closes when the call settles.

The result is a hint. Any page can link to the redirect URI with the same parameters, so read the account's balance before relying on a deposit.

The deposit page needs a Tempo ID session. Without one, the page signs the user in and then opens the account page, so the popup does not return, and the call stays pending until `signal` aborts, or the user selects **Cancel** in the page's dialog. Call it after a sign-in, such as [`Actions.dialog.signIn`](Actions.dialog.signIn.md).

> [!NOTE]
> Do not send `Cross-Origin-Opener-Policy: same-origin` on the page that calls `open`. That policy severs the page's handle to the popup. The popup then loads the redirect URI with the result, and the call stays pending until `signal` aborts.

## Usage

```ts
import { Actions } from 'accounts'

button.addEventListener('click', async () => {
  const result = await Actions.funding.open(config, {
    address: authorization.address,
    amount: '10',
    currency: 'USD',
  })
  if (result?.status === 'received') await refreshBalance()
})
```

## Return type

`{ amount?: string; status: 'closed' | 'continued' | 'received' } | undefined`. `undefined` in `redirect` mode.

### amount

- **Type:** `string | undefined`

The USD value that the deposit page saw the account receive, or the confirmed amount of a Buy MACH purchase, as a decimal string, such as `25.500000`. Present only for `received`, and absent for a deposit that the page could not value, such as a faucet deposit on a chain whose balance does not load.

### status

- **Type:** `'closed' | 'continued' | 'received'`

`received` when **Done** on a receive screen saw a deposit arrive, after a confirmed Buy MACH purchase, or after the faucet of a test chain funded the account. `continued` when the user selected **Continue to** the app without a deposit, which only a tab offers. `closed` when the user closed the popup, such as before a transfer from another network lands, or selected **Cancel** in the page's dialog.

## Parameters

### address

- **Type:** `` `0x${string}` | Promise<`0x${string}`> | (() => Promise<`0x${string}`>) ``

The Tempo Account that receives the deposit. It must be one of the signed-in user's accounts in the `default` realm, or the page shows that it found no wallet. A promise, such as a read of the account, resolves after the popup opens, so the popup still opens within the gesture. A function that returns one runs only after the other parameters pass their checks and the popup opens, so a refused call starts no read.

```ts
const result = await Actions.funding.open(config, { address })
```

### amount (optional)

- **Type:** `string`

The amount that the app needs, as a decimal string. With `currency` and `token`, it selects the methods that the page lists, as [Deposit methods](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-methods) describes. Tempo ID checks the hint against the listed tokens of the deposit's chain. Without it, or for a hint that Tempo ID refuses, the page lists every method.

```ts
const result = await Actions.funding.open(config, { address, amount: '20' })
```

### chainId (optional)

- **Type:** `number`
- **Default:** The instance's `chainId`

The chain of the deposit. The page's `chain` parameter names Tempo mainnet and Tempo testnet as `mainnet` and `testnet`, and another chain by its ID. On a chain whose faucet funds accounts, such as Tempo testnet, the page offers the faucet first, and a successful faucet deposit returns `received`.

```ts
const result = await Actions.funding.open(config, { address, chainId: 42431 })
```

### currency (optional)

- **Type:** `string`
- **Default:** The currency of `token`, or `USD`

The ISO 4217 currency of `amount`, such as `EUR`. Every listed token of the currency counts. It needs `amount`.

```ts
const result = await Actions.funding.open(config, {
  address,
  amount: '20',
  currency: 'EUR',
})
```

### mode (optional)

- **Type:** `'frame' | 'popup' | 'redirect'`
- **Default:** `'frame'`

Where the deposit page opens: a frame in a dialog on the page, a popup window, or the same tab through a redirect. A page that runs Coinflow where no frame can opens `frame` in a popup: Buy MACH for a hint of `MACH` on Tempo mainnet, on iOS, iPadOS, or for a third-party app. Apple Pay runs only on a top-level page, and Coinflow's purchase protection does not run in a cross-site frame. A deposit list runs no Coinflow, so it opens in the frame, which continues Buy MACH in a popup.

```ts
await Actions.funding.open(config, { address, mode: 'redirect' })
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin

One of the app's registered redirect URIs, which the page returns to. In `popup` mode, it is on the page's origin. The page offers no way back to the app for a redirect URI that the app did not register.

```ts
const result = await Actions.funding.open(config, {
  address,
  redirectUri: 'https://app.example/',
})
```

### signal (optional)

- **Type:** `AbortSignal`

Rejects the call with the signal's reason, and closes the popup.

```ts
const result = await Actions.funding.open(config, {
  address,
  signal: AbortSignal.timeout(600_000),
})
```

### token (optional)

- **Type:** `string`

The symbol or address of the only token that counts toward `amount`, such as `USDC.e`. Its currency must equal `currency`. It needs `amount`. On Tempo mainnet, `MACH` opens Buy MACH with `amount` in place of the list of methods.

```ts
const result = await Actions.funding.open(config, {
  address,
  amount: '10',
  token: 'USDC.e',
})
```

## Errors

### `Actions.funding.BlockedError`

Thrown in `popup` mode when the browser blocks the popup, such as for a call outside a user gesture, or after an `await` in the click handler. Call `open` first in the handler, or pass `mode: 'redirect'`.

### `Actions.funding.OriginError`

Thrown in `popup` mode before the popup opens, when the redirect URI is not on the page's origin. Call `open` on a page of the redirect URI's origin, or pass `mode: 'redirect'`.

### `signal.reason`

Thrown when `signal` aborts, such as a `TimeoutError` from `AbortSignal.timeout`.
