# Redirect sign-in

## Overview

A browser app without its own sign-in UI signs in on Tempo ID's pages. They sign the user in, show the access key's limits for approval, and return a code to the app. The [`dialog`](../api/plugins.dialog.md) plugin shows the pages in a dialog on the app's page, or in a popup. The [`redirect`](../api/plugins.redirect.md) plugin leaves the page for them, and returns to the redirect URI.

| Plugin     | Where the sign-in shows                   | The app's page                                              |
| ---------- | ----------------------------------------- | ----------------------------------------------------------- |
| `dialog`   | A dialog that frames `/embed`, or a popup | Stays loaded, and `signIn` resolves with the session        |
| `redirect` | The same window                           | Leaves, and `session.get()` completes the sign-in on return |

An instance without a sign-in plugin receives `dialog`, so `Accounts.create()` alone signs in through the dialog.

```ts
import { Accounts } from 'accounts'
import { dialog } from 'accounts/plugins'
import { tempo } from 'viem/tempo/chains'

// 1. The page loads the dialog's frame, hidden, as the instance is created.
const accounts = Accounts.create({
  // Each sign-in requests an access key that may transfer up to 100 OUSD for 30 days.
  accessKey: () => ({
    expiry: '30d',
    limits: [{ limit: '100', token: 'ousd' }],
  }),
  plugins: [dialog()],
})

// 2. On every page load, restore the saved session.
const session = await accounts.session.get()

// 3. Otherwise, the sign-in button shows Tempo ID's sign-in in the dialog.
if (!session)
  button.onclick = async () => {
    const signedIn = await accounts.dialog.signIn()
    render(signedIn)
  }
```

1. The page's origin is the client ID and the redirect URI by default, so the app needs no registration. The [`dialog`](../api/plugins.dialog.md) plugin preloads the frame of the [embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md), so the first sign-in shows at once.
2. [`accounts.session.get`](../api/Accounts.create.md#sessionget) reads the session from IndexedDB, and empties one whose access key expired.
3. [`dialog.signIn`](../api/plugins.dialog.md#dialogsignin) shows the sign-in, waits for the user's approval, redeems the code, and sets the session. Call it in the click handler, before any `await`, since a popup opens only within the gesture.

The user approves the access key, so its limits may exceed the [headless ceiling](https://github.com/tempoxyz/id/blob/main/docs/permissions.md#headless-ceiling). The page must be on the redirect URI's origin, since the callback reaches only a page of that origin.

## Recipes

### Leave the page for the sign-in

The `redirect` plugin sends the browser to Tempo ID's pages in the same window. On return, the first `session.get()` of the page checks the callback's state, redeems its code once, removes `code` and `state` from the address bar, and sets the session. Call it before any routing that reads the URL.

```ts
import { Accounts } from 'accounts'
import { redirect } from 'accounts/plugins'

const accounts = Accounts.create({ plugins: [redirect()] })

const session = await accounts.session.get()
if (!session) button.onclick = () => accounts.redirect.signIn()
```

### Return to a specific page

The browser returns to the instance's `redirectUri`, which defaults to the page's origin. Register the URI with the app first.

```ts
const accounts = Accounts.create({
  clientId: 'client_…',
  plugins: [redirect()],
  redirectUri: 'https://app.example/callback',
})
```

### Sign in in a popup

`popup: true` runs the redirect sign-in in a popup window in place of the dialog's frame. Tempo ID's page in the popup posts the callback to the opening page, and closes the popup, so the popup never loads the redirect URI. A page that sends `Cross-Origin-Opener-Policy: same-origin` severs the popup's `window.opener`, so the popup returns to the redirect URI, whose page calls [`dialog.callback`](../api/plugins.dialog.md#dialogcallback) first.

```ts
const accounts = Accounts.create({ plugins: [dialog({ popup: true })] })

// On the redirect URI's page, before any other work. A popup's callback
// closes the popup, so the app starts only on any other load.
if (!(await accounts.dialog.callback())) startApp()
```

A popup that the user closes rejects the call with an `AbortError`. A cancel button or a timeout aborts `signal`, which closes the dialog or the popup.

```ts
const controller = new AbortController()
cancel.onclick = () => controller.abort()
const session = await accounts.dialog.signIn({ signal: controller.signal })
```

### Reuse a session from another app

A first-party app on Tempo ID's site reuses the user's Tempo ID session with [`accounts.authorize`](../api/Accounts.create.md#authorize), with no sign-in. It returns `undefined` for a visitor without one. The access key must fit the headless ceiling.

```ts
const session = (await accounts.session.get()) ?? (await accounts.authorize())
if (!session) showSignInButton()
```

### Load the sign-in page sooner

A page on Tempo ID's site, such as `app.tempo.xyz` for `id.tempo.xyz`, can prefetch the scripts and style sheets of the sign-in page once its sign-in button shows. The sign-in page then loads them from the browser's cache. A page on another site gains nothing, since a browser partitions its cache by site.

```ts
showSignInButton()
// The prefetch never throws, and the sign-in works without it.
void accounts.redirect.prefetch()
```

### Keep the session elsewhere

`store` defaults to IndexedDB. With the default, a redirect also keeps the `state`, the redirect URI, and the PKCE verifier in the tab's `sessionStorage`, so the callback page redeems the code before IndexedDB's first read. A custom `store` holds the session and the whole state alone. It must store values without serializing them, since a browser access key is a non-extractable `CryptoKey`.

```ts
import { Accounts, Store } from 'accounts'
import * as Idb from 'idb-keyval'

const accounts = Accounts.create({
  plugins: [redirect()],
  store: Store.from({
    getItem: (key) => Idb.get(key),
    removeItem: (key) => Idb.del(key),
    setItem: (key, value) => Idb.set(key, value),
  }),
})
```

### Develop on localhost

`id.tempo.xyz` and a deployment for local development, such as `pnpm dev`, accept the page's localhost origin as its client ID, such as `http://localhost:5173` or `https://app.localhost`, with no registration. The browser returns to any path on that origin, on the same port, such as `/auth/callback`.

```ts
const accounts = Accounts.create({
  dev: true,
  url: 'https://id.tempo.local',
})
```

A deployment without `LOCALHOST_CLIENT_IDS` refuses a localhost origin with [`localhost_not_permitted`](https://github.com/tempoxyz/id/blob/main/docs/errors.md#localhost_not_permitted), as [Localhost origins](https://github.com/tempoxyz/id/blob/main/docs/apps.md#localhost-origins) describes.

## Learn more

- [Custom sign-in UI](custom-ui.md)
- [Backends](backend.md)
- [`dialog`](../api/plugins.dialog.md)
- [`redirect`](../api/plugins.redirect.md)
- [Embedded sign-in](https://github.com/tempoxyz/id/blob/main/docs/embedded-sign-in.md)
- [Authentication](https://github.com/tempoxyz/id/blob/main/docs/authentication.md)
