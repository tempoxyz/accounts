# Actions.dialog.signIn

## Overview

Signs the user in on Tempo ID without leaving the app's page, and resolves with the authorization. The page keeps the PKCE verifier and the new access key in memory, and redeems the code, as [`Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md) does. `mode` selects where the sign-in runs:

| `mode`            | Where                                                                                                                    | Access key bound                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| `iframe`, default | Tempo ID's [embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md) in a dialog on the page | The [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling) |
| `popup`           | Tempo ID's pages in a popup window, which post the callback to the app's page                                            | The user approves the access key on the approval page                                                 |

The `iframe` dialog is a compact modal, and a bottom sheet on a screen narrower than 480 pixels. It posts the request to its frame, and shows once the frame's page shows the request, at once after [`Actions.dialog.preload`](Actions.dialog.preload.md), so it never shows an empty frame. A preloaded frame takes any access key. The frame's page draws a bar above its content, with the Tempo logo, the host of Tempo ID's page, and a close button. The Escape key, the backdrop, and the close button close the dialog. It needs a page on the redirect URI's origin. The frame of an app without the `tempo-id:iframe` scope acts only while the browser reports it unobscured. In a browser without IntersectionObserver v2, `signIn` opens a popup in the click for such an app. It does the same for any app whose page did not preload the frame, since only a loaded frame reports the app's trust before the click. After a sign-in, the dialog hides its frame and keeps it loaded for the next one. The frame shows the approval page and the account step itself, such as for a third-party app's consent and access key. When the frame does not load, when Tempo ID refuses the request, such as for an access key above the ceiling, when the frame may be covered, or when the sign-in needs a wallet upgrade or a wallet.tempo passkey link, the dialog offers a popup. The user's click on **Continue** opens it, with the same request.

Both the frame and the popup show compact screens, whose title and description align to the start without the icon. A popup's request carries OpenID Connect's `display=popup`, so each page in the popup shows them. The popup opens 432 pixels wide, and each page fits the window's height to its content, up to the screen's height. A browser that opens the popup as a tab keeps the tab's size.

Call it in a user gesture, such as a click. In `iframe` mode, a call outside a gesture that needs a popup shows a dialog that offers **Continue**, whose click opens the popup. A popup opens before the first `await`, since a popup blocker accepts `window.open` only within the gesture. Outside a secure context, and with `funding` for a hint of `MACH` on Tempo mainnet, on iOS, iPadOS, or for a third-party app, `iframe` runs as `popup`. An instance that pushes its requests, with `par`, also signs in with `popup`, since the frame takes the request's own parameters. The push then holds `display=popup`, and the popup's URL repeats it with `redirect_uri`, which the issuer ignores beside `request_uri`. The page must be on the redirect URI's origin in either mode, since the callback reaches only a page of that origin.

While the popup is open, a modal dialog on the app's page states **Continue in the Tempo ID window.** It blocks input to the page. **Show window** and a click on the backdrop focus the popup, which a browser can refuse to raise above the page. **Cancel** and the Escape key close the popup and reject the call with an `AbortError`. The dialog closes when the call settles.

Tempo ID's page in a popup posts the callback to the app's page that opened it, at the redirect URI's origin only, and closes the popup. The popup never loads the redirect URI, so the redirect URI's page needs no code for it.

A popup that the user closes rejects the call with an `AbortError`, in either mode. The sign-in pages of a popup's request, `/oauth2/authorize`, `/login`, `/authorize`, and `/choose-account`, send no `Cross-Origin-Opener-Policy`, so the app's page keeps its handle to the popup. Every other page keeps the policy. Each of these pages reports to the app's page from its head, as it loads. A popup that reads closed after that report rejects the call one second later, unless its callback arrives first. A popup that the user closes before it navigates rejects the call at once. A close after the popup navigates and before its first response arrives leaves the call pending, since an app page with `Cross-Origin-Opener-Policy: same-origin` reads its popup as closed from that navigation on.

> [!NOTE]
> Do not send `Cross-Origin-Opener-Policy: same-origin` on the page that calls `signIn`. Send no policy, `unsafe-none`, or `same-origin-allow-popups`. `same-origin` severs the page's handle to the popup, so the popup returns to the redirect URI, whose page calls [`Actions.dialog.callback`](Actions.dialog.callback.md), in either mode. The browser then reports no close of the popup, and the call stays pending until `signal` aborts, or until the instance's next `signIn` replaces it.

## Usage

```ts
import { Actions } from 'accounts'
import { Expiry, Scopes } from 'viem/tempo'

button.addEventListener('click', async () => {
  const authorization = await Actions.dialog.signIn(config, {
    accessKey: {
      expiry: Expiry.days(30),
      limits: [{ limit: 100_000_000n, token: ousd }],
      scopes: [Scopes.tip20(ousd).transfer()],
    },
  })
})
```

## Return type

`Authorization.Authorization`, with [`Authorization`](types.md#authorization). Without `accessKey`, the authorization omits `accessKey` and `key`.

## Parameters

### accessKey (optional)

- **Type:** [`Permissions.WithAccount`](types.md#permissionswithaccount)

What the access key may do, which requests the access key, and the app's own access key as `account`. Without it, the sign-in authorizes no access key, and takes no `challenge`. The access key names its `limits` and `scopes`. Without `expiry`, Tempo ID fills the [default expiry](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#default-expiry). In `iframe` mode, an access key above the headless ceiling falls back to the popup, whose approval page shows it.

`account` is the app's own access key, as an `Account.Account` from `viem/tempo`. Its `access` names the Tempo Account, which defaults to the one that the user selects at sign-in, or the user's oldest. It defaults to a new access key: WebCrypto P256 in a browser, secp256k1 elsewhere. Without `account`, `publicKey` and `type` name an access key whose private key the page does not hold, such as one on the app's server, and `type` defaults to `secp256k1`. The result's `accessKey` then rejects each signature with `AccessKey.AccessKeyRequiredError`.

```ts
const authorization = await Actions.dialog.signIn(config, {
  accessKey: {
    account,
    expiry: Expiry.days(30),
    limits: [{ limit: 50_000_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  },
})
```

### challenge (optional)

- **Type:** `string`

A message whose EIP-191 hash the key authorization binds as its `witness`. It needs the `tempo-id:sign` scope and `accessKey`, as [Challenges](https://github.com/tempoxyz/id/blob/main/docs/challenges.md) describes.

```ts
const authorization = await Actions.dialog.signIn(config, {
  accessKey,
  challenge,
})
```

### funding (optional)

- **Type:** [`Funding`](types.md#funding)

The amount that the app needs in the user's Tempo Account, as [Funding hints](https://github.com/tempoxyz/id/blob/main/docs/funding-hints.md) describes. After the approval, an account that holds less opens Tempo ID's funding page in the popup, which posts the callback once the user continues. In `iframe` mode, the sign-in completes in the frame, then the call redeems the code and opens the deposit page as [`Actions.funding.open`](Actions.funding.open.md) does in `frame` mode. The call resolves once that page returns or closes. A failure of the deposit page does not reject the call, unless `signal` aborts. With `funding` for a hint of `MACH` on Tempo mainnet, on iOS, iPadOS, or for a third-party app, `iframe` runs as `popup`. Without it, no funding page opens.

```ts
const authorization = await Actions.dialog.signIn(config, {
  funding: { amount: '10', currency: 'USD' },
})
```

### mode (optional)

- **Type:** `'iframe' | 'popup'`
- **Default:** `'iframe'`

Where the sign-in runs: Tempo ID's embedded sign-in in a dialog on the page, or a popup window.

```ts
const authorization = await Actions.dialog.signIn(config, { mode: 'popup' })
```

### prompt (optional)

- **Type:** `'login'`

Requests a new sign-in of a user whom the browser holds signed in. Tempo ID shows its sign-in page with the email field filled. Without it, Tempo ID reuses the browser's session.

```ts
const authorization = await Actions.dialog.signIn(config, { prompt: 'login' })
```

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin

The registered redirect URI, on the page's origin. A popup posts the callback to the page at its origin, or returns to it from a page that severs the popup's `window.opener`.

```ts
const authorization = await Actions.dialog.signIn(config, {
  redirectUri: 'https://app.example/',
})
```

### signal (optional)

- **Type:** `AbortSignal`

Rejects the call with the signal's reason, such as on a timeout or a cancel button, and closes the dialog or the popup. Without it, a popup that the user closes on a page that severs its handle to the popup, with `Cross-Origin-Opener-Policy: same-origin`, leaves the call pending until the instance's next `signIn`.

```ts
const authorization = await Actions.dialog.signIn(config, {
  signal: AbortSignal.timeout(300_000),
})
```

### timeout (optional)

- **Type:** `number`
- **Default:** `10_000`

Milliseconds after the call that the frame has to show the request, before the dialog offers the popup. A frame that Tempo ID refuses offers it sooner, 3 seconds after its `load` event.

```ts
const authorization = await Actions.dialog.signIn(config, { timeout: 5_000 })
```

## Errors

### `Actions.dialog.BlockedError`

Thrown in `popup` mode when the browser blocks the popup, such as for a call outside a user gesture, or after an `await` in the click handler. Call `signIn` first in the handler, or sign in through [`Actions.redirect.start`](Actions.redirect.start.md). An `iframe` call outside a gesture that needs a popup offers **Continue** instead, and a later sign-in closes the offer with an `AbortError`.

### `Actions.dialog.OriginError`

Thrown before any popup opens when the redirect URI is not on the page's origin. Call `signIn` on a page of the redirect URI's origin, or sign in through [`Actions.redirect.start`](Actions.redirect.start.md).

### `Accounts.RequestError`

Thrown for a callback with a `code`, with the [errors of `Actions.redirect.handleCallback`](Actions.redirect.handleCallback.md#errors).

Thrown for a callback that denies the sign-in, such as when the user denies the approval page. Its `code` is the callback's `error`, such as `access_denied`, its `message` is the `error_description`, and its `status` is 0.

### `Accounts.ChallengeWithoutKeyError`

Thrown when the call receives `challenge` without `accessKey`. Remove `challenge`, or request an access key.

### `AbortError`

A `DOMException` thrown when the user closes the dialog or the popup, cancels the popup from the page's dialog, or when the instance's next `signIn` replaces a pending sign-in in either mode.

### `signal.reason`

Thrown when `signal` aborts, such as a `TimeoutError` from `AbortSignal.timeout`, also while the page redeems the code.
