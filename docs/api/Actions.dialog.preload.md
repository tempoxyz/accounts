# Actions.dialog.preload

## Overview

Loads the `iframe` dialog of a later [`Actions.dialog.signIn`](Actions.dialog.signIn.md), hidden, so the dialog shows the sign-in at once. It frames `/embed` for the app and the redirect URI alone, in a dialog that stays hidden until `signIn`. The [`dialog`](plugins.dialog.md) plugin calls it when the instance is created, unless its `preload` is `false` or its `popup` is `true`.

The frame loads without a request, so `signIn` takes it whatever its `accessKey` or `challenge`. `signIn` posts its request to the frame, which shows the access key at once while Tempo ID checks and signs the request. Only a `signIn` with another `redirectUri` discards the frame, and its dialog then shows once its own frame is ready.

Each sign-in keeps the frame loaded, hidden, whether it preloaded or not, and the next one posts its request to the same frame, which starts the sign-in again. Only a frame that failed, whose dialog offered a popup, loads again, and so does one whose dialog the page removed, such as a framework that mounts into the body after the client preloads it. Outside a secure context, and for an instance that pushes its requests with `par`, the call loads nothing, since `signIn` then opens a popup. On a page that is not on the redirect URI's origin, it loads nothing either, since `signIn` then throws `Actions.dialog.OriginError`.

## Usage

```ts
import { Actions } from 'accounts/internal'

Actions.dialog.preload(config)

button.addEventListener('click', async () => {
  const authorization = await Actions.dialog.signIn(config, { accessKey })
})
```

## Return type

`void`. The frame loads in the background. A frame that fails to load makes the dialog offer a popup when `signIn` shows it.

## Parameters

### redirectUri (optional)

- **Type:** `string`
- **Default:** The instance's `redirectUri`, or the page's origin

The registered redirect URI, on the page's origin. `signIn` takes the preload only for the same redirect URI.

```ts
Actions.dialog.preload(config, { redirectUri: 'https://app.example/' })
```
