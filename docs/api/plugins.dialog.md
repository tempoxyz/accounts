# dialog

## Overview

The plugin of sign-in on Tempo ID's pages without leaving the app's page. It adds `accounts.dialog.signIn` and `accounts.dialog.callback`. By default, the sign-in shows Tempo ID's [embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md) in a dialog on the page. With `popup`, it runs the redirect sign-in in a popup window instead. The user approves the access key on Tempo ID's page, so its limits may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling).

A browser page loads the dialog's frame, hidden, as the instance is created, so the first sign-in shows at once. The page must be on the redirect URI's origin, since the callback reaches only a page of that origin.

An instance without a sign-in plugin receives this plugin with its default options. Its code then loads on demand, as [`Accounts.create`](Accounts.create.md) describes, so `Accounts.create()` alone offers `accounts.dialog.signIn()`.

## Usage

```ts
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [dialog()] })

button.onclick = () => accounts.dialog.signIn()
```

## Return type

`Plugin<'dialog', { callback, signIn }>`

### dialog.callback

- **Type:** `() => Promise<boolean>`

Completes a popup's sign-in on the page of the redirect URI, and closes the popup. Returns whether the page was the callback of a popup. Tempo ID's page in the popup posts the callback to the opening page itself, so only an app whose page sends `Cross-Origin-Opener-Policy: same-origin` needs it.

```ts
if (await accounts.dialog.callback()) return
```

### dialog.signIn

- **Type:** `(parameters?: dialog.signIn.Parameters) => Promise<Session>`

Signs the user in, sets the instance's [session](types.md#session), and returns it. Call it in a click handler, before any `await`, since a popup opens only within the gesture. The session holds no Tempo Account, so read it with [`accounts.account.get`](Accounts.create.md#accountget) if necessary.

```ts
button.onclick = async () => {
  const session = await accounts.dialog.signIn()
}
```

## Parameters

### par (optional)

- **Type:** `boolean`
- **Default:** `true` with `clientSecret` or `clientAssertion`, and `false` otherwise

Whether each request goes to `POST /oauth2/par` first ([RFC 9126](https://www.rfc-editor.org/rfc/rfc9126)), as [Pushed authorization requests](https://github.com/tempoxyz/id/blob/main/docs/pushed-authorization-requests.md) describes. A pushed request signs in with a popup only.

```ts
const accounts = Accounts.create({ plugins: [dialog({ par: true })] })
```

### popup (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether to sign in in a popup window in place of a frame. With it, the page preloads no frame.

```ts
const accounts = Accounts.create({ plugins: [dialog({ popup: true })] })
```

### preload (optional)

- **Type:** `boolean`
- **Default:** `true`

Whether a browser page loads the dialog's frame, hidden, as the instance is created.

```ts
const accounts = Accounts.create({ plugins: [dialog({ preload: false })] })
```

### dialog.signIn parameters

#### accessKey (optional)

- **Type:** [`Permissions`](types.md#permissions) `| (() => Permissions | undefined) | false`
- **Default:** The instance's `accessKey`

What the access key may do, a function that returns it, or `false` for a sign-in without an access key.

```ts
const session = await accounts.dialog.signIn({ accessKey: false })
```

#### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const session = await accounts.dialog.signIn({ challenge })
```

#### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account. After the approval, an account that holds less opens Tempo ID's funding page before the callback, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md#popup-and-embedded-sign-in) describes. In the frame, the sign-in completes first, then the deposit page opens in a frame, as [`accounts.funding.open`](plugins.funding.md) does, and the call resolves once that page returns or closes. For a hint of `MACH` on Tempo mainnet, the frame shows Buy MACH's amount step, and **Pay by card** continues in a popup from that click. On iOS and iPadOS, whose Apple Pay runs only on a top-level page, the sign-in runs in a popup.

```ts
const session = await accounts.dialog.signIn({
  funding: { amount: '10', currency: 'USD' },
})
```

#### mode (optional)

- **Type:** `'iframe' | 'popup'`
- **Default:** `'popup'` with the plugin's `popup`, else `'iframe'`

Whether the sign-in shows in a frame or in a popup window. Outside a secure context, for a pushed request, and with `funding` for a hint of `MACH` on Tempo mainnet, on iOS, iPadOS, or for a third-party app, `iframe` runs as `popup`.

```ts
const session = await accounts.dialog.signIn({ mode: 'popup' })
```

#### signal (optional)

- **Type:** `AbortSignal`

Rejects the sign-in with the signal's reason, such as on a cancel button, and closes the dialog or the popup.

```ts
const controller = new AbortController()
cancel.onclick = () => controller.abort()
const session = await accounts.dialog.signIn({ signal: controller.signal })
```

## Errors

### `Accounts.RequestError`

Thrown for a callback with a `code` when Tempo ID refuses the code:

#### Requests

- [`rate_limited`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#rate_limited): The request exceeded a rate limit. Retry later.
- [`unexpected`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#unexpected): An unexpected failure. Retry the request.

#### Without a `reason`

- **`invalid_request`:** The callback's `state` does not match `pending`. Start sign-in again.
- **The callback's `error`:** The callback carries no `code`, such as `access_denied` after a denial. An access key that Tempo ID refuses before sign-in returns its own `error`, such as `invalid_authorization_details` for an access key that breaks a [rule](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#rules), or `unauthorized_client` for a `challenge` without the `tempo-id:sign` scope. `message` is the `error_description`.
- **`invalid_grant`:** The code was already redeemed, expired, or carried no key authorization. Only the first redemption, within 10 minutes of the approval, returns the access key. Start sign-in again.

Thrown for a callback that denies the sign-in, such as when the user denies the approval page. Its `code` is the callback's `error`, such as `access_denied`, its `message` is the `error_description`, and its `status` is 0.

### `DOMException`

Thrown with the name `AbortError` when the user closes the dialog or the popup, or when the next sign-in of the instance replaces a pending one.

### `Actions.dialog.BlockedError`

Thrown when the browser blocks the popup, since the call ran outside a user gesture.

### `Actions.dialog.OriginError`

Thrown when the redirect URI is on another origin than the page.

### `Accounts.SupersededError`

Thrown when another sign-in or a sign-out completed while this sign-in was pending.

### `Accounts.ChallengeWithoutKeyError`

Thrown before any request for `challenge` without `accessKey`.
