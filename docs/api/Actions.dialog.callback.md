# Actions.dialog.callback

## Overview

Posts the callback to the page that opened a popup of [`Actions.dialog.signIn`](Actions.dialog.signIn.md), and closes the popup. Only an app whose page sends `Cross-Origin-Opener-Policy: same-origin` needs it. On any other page, Tempo ID's page in the popup posts the callback to the opening page itself, and the popup never loads the redirect URI.

That policy severs the popup's `window.opener`, so the popup returns to the redirect URI. For such an app, call it on the redirect URI's page, before [`Actions.redirect.complete`](Actions.redirect.complete.md), which removes a callback that it did not start from the address bar. The `iframe` mode needs it too, since its dialog can fall back to a popup.

The callback reaches the opening page on a `BroadcastChannel` of the page's origin, named for the sign-in's `state`. `signIn` stores that `state` in the instance's `store`, so the callback page identifies a popup's callback. The default IndexedDB `store` is shared by every tab of the origin. A custom `store` must be shared too.

## Usage

```ts
import { Actions } from 'accounts/internal'

// On the redirect URI's page of an app that sends `Cross-Origin-Opener-Policy: same-origin`,
// before any other sign-in:
if (await Actions.dialog.callback(config)) return
const authorization =
  (await Actions.redirect.complete(config)) ?? (await Actions.authorize(config))
```

## Return type

`boolean`. `true` on the callback of a popup of `Actions.dialog.signIn`. The popup then closes. `false` on any other page load, such as the callback of a redirect sign-in.
