# funding

## Overview

The plugin of Tempo ID's deposit page, which adds `tempoId.funding.open` and `tempoId.funding.complete`. Every instance holds it with its default options, so an app passes it only to set them. `open` opens the deposit page for the session's Tempo Account, as [`Actions.funding.open`](Actions.funding.open.md) does, in a popup or through a redirect. The page returns to one of the app's registered redirect URIs, as [Deposit page of an app](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#deposit-page-of-an-app) describes.

The plugin needs a browser page, for the popup or the redirect.

## Usage

```ts
import { Id } from 'accounts'

const tempoId = Id.create({ redirectUri: 'https://app.example/' })

button.addEventListener('click', async () => {
  const result = await tempoId.funding.open({ amount: '10', currency: 'USD' })
  if (result?.status === 'received') await refreshBalance()
})
```

## Return type

`Plugin<'funding', { complete, open }>`

### funding.complete

- **Type:** `(parameters?: { redirectUri?: string; url?: string | URL }) => { amount?: string; status: 'continued' | 'received' } | undefined`

Returns the result of the deposit page that `open` opened with `mode: 'redirect'`, on the redirect URI's page, as [`Actions.funding.complete`](Actions.funding.complete.md) does. Without `url`, it reads the page's URL, and removes the result from the address bar.

```ts
const result = tempoId.funding.complete()
```

### funding.open

- **Type:** `(parameters?: funding.open.Parameters) => Promise<{ amount?: string; status: 'closed' | 'continued' | 'received' } | undefined>`

Opens the deposit page, and returns its result, as [`Actions.funding.open`](Actions.funding.open.md#return-type) describes. Call it in a user gesture, such as a click. It takes the parameters of [`Actions.funding.open`](Actions.funding.open.md#parameters): `amount`, `chainId`, `currency`, `mode`, `redirectUri`, `signal`, and `token`. `address` defaults to the session's account, else to the access key's account, on the instance's chain. Otherwise, after the popup opens, `open` loads the stored session and reads the account on the call's chain with a live access token, which it refreshes when it expires within 30 seconds. A popup that the user closes before the address loads returns `closed`.

```ts
const result = await tempoId.funding.open({ amount: '10', token: 'USDC.e' })
```

## Parameters

### mode (optional)

- **Type:** `'frame' | 'popup' | 'redirect'`
- **Default:** `'frame'`

Where every `open` opens the deposit page, unless the call passes `mode`.

```ts
import { funding } from 'accounts/plugins'

const tempoId = Id.create({ plugins: [funding({ mode: 'redirect' })] })
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin with `/`

The registered redirect URI that the deposit page returns to, unless the call passes `redirectUri`.

```ts
const tempoId = Id.create({
  plugins: [funding({ redirectUri: 'https://app.example/wallet' })],
})
```

## Errors

### `Plugins.funding.SignedOutError`

Thrown by `open` when the instance holds no session, or the session's account read returns none. Sign the user in first.

The errors of [`Actions.funding.open`](Actions.funding.open.md#errors) also apply.
