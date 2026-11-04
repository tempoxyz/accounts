# dialog

## Overview

The plugin of sign-in on Tempo ID's pages without leaving the app's page. It adds `tempoId.dialog.signIn` and `tempoId.dialog.callback`. By default, the sign-in shows Tempo ID's [embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md) in a dialog on the page. With `popup`, it runs the redirect sign-in in a popup window instead. The user approves the access key on Tempo ID's page, so its limits may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

A browser page loads the dialog's frame, hidden, as the instance is created, so the first sign-in shows at once. The page must be on the redirect URI's origin, since the callback reaches only a page of that origin.

An instance without a sign-in plugin receives this plugin with its default options. Its code then loads on demand, as [`Id.create`](Id.create.md) describes, so `Id.create()` alone offers `tempoId.dialog.signIn()`.

## Usage

```ts
import { Id } from 'accounts'
import { dialog } from 'accounts/plugins'

const tempoId = Id.create({ plugins: [dialog()] })

button.onclick = () => tempoId.dialog.signIn()
```

## Return type

`Plugin<'dialog', { callback, signIn }>`

### dialog.callback

- **Type:** `() => Promise<boolean>`

Completes a popup's sign-in on the page of the redirect URI, and closes the popup, as [`Actions.dialog.callback`](Actions.dialog.callback.md) does. Returns whether the page was the callback of a popup. Tempo ID's page in the popup posts the callback to the opening page itself, so only an app whose page sends `Cross-Origin-Opener-Policy: same-origin` needs it.

```ts
if (await tempoId.dialog.callback()) return
```

### dialog.signIn

- **Type:** `(parameters?: dialog.signIn.Parameters) => Promise<Session>`

Signs the user in, sets the instance's [session](types.md#session), and returns it, as [`Actions.dialog.signIn`](Actions.dialog.signIn.md) does. Call it in a click handler, before any `await`, since a popup opens only within the gesture. The session holds no Tempo Account, so read it with [`tempoId.account.get`](Id.create.md#accountget) if necessary.

```ts
button.onclick = async () => {
  const session = await tempoId.dialog.signIn()
}
```

## Parameters

### par (optional)

- **Type:** `boolean`
- **Default:** `true` with `clientSecret` or `clientAssertion`, and `false` otherwise

Whether each request goes to `POST /oauth2/par` first ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), as [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md) describes. A pushed request signs in with a popup only.

```ts
const tempoId = Id.create({ plugins: [dialog({ par: true })] })
```

### popup (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether to sign in in a popup window in place of a frame. With it, the page preloads no frame.

```ts
const tempoId = Id.create({ plugins: [dialog({ popup: true })] })
```

### preload (optional)

- **Type:** `boolean`
- **Default:** `true`

Whether a browser page loads the dialog's frame, hidden, as the instance is created, as [`Actions.dialog.preload`](Actions.dialog.preload.md) does.

```ts
const tempoId = Id.create({ plugins: [dialog({ preload: false })] })
```

### dialog.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
const session = await tempoId.dialog.signIn({ accessKey: false })
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const session = await tempoId.dialog.signIn({ challenge })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account. After the approval, an account that holds less opens Tempo ID's funding page before the callback, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#popup-and-embedded-sign-in) describes. In the frame, the sign-in completes first, then the deposit page opens in a frame, as [`tempoId.funding.open`](plugins.funding.md) does, and the call resolves once that page returns or closes. On iOS and iPadOS, a sign-in with `funding` runs in a popup.

```ts
const session = await tempoId.dialog.signIn({
  funding: { amount: '10', currency: 'USD' },
})
```

#### mode (optional)

- **Type:** `'iframe' | 'popup'`
- **Default:** `'popup'` with the plugin's `popup`, else `'iframe'`

Whether the sign-in shows in a frame or in a popup window. Outside a secure context, for a pushed request, and with `funding` on iOS and iPadOS, `iframe` runs as `popup`.

```ts
const session = await tempoId.dialog.signIn({ mode: 'popup' })
```

#### signal (optional)

- **Type:** `AbortSignal`

Rejects the sign-in with the signal's reason, such as on a cancel button, and closes the dialog or the popup.

```ts
const controller = new AbortController()
cancel.onclick = () => controller.abort()
const session = await tempoId.dialog.signIn({ signal: controller.signal })
```

## Errors

### `Id.RequestError`

Thrown for each refusal that [`Actions.dialog.signIn`](Actions.dialog.signIn.md#errors) lists, such as a denial.

### `DOMException`

Thrown with the name `AbortError` when the user closes the dialog or the popup, or when the next sign-in of the instance replaces a pending one.

### `Actions.dialog.BlockedError`

Thrown when the browser blocks the popup, since the call ran outside a user gesture.

### `Actions.dialog.OriginError`

Thrown when the redirect URI is on another origin than the page.

### `Id.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.

### `Id.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
