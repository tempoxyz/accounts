# Mobile apps

## Overview

An Expo app signs users in on Tempo ID's pages, in an authentication sheet, with the [`expo`](../api/plugins.expo.md) preset. The preset keeps the session in the device's secure store, and adds the [`redirect`](../api/plugins.redirect.md) plugin, whose sign-in opens the sheet. The app's redirect URI is a custom scheme, such as `com.example.app:/callback`. A native app cannot call `POST /v1/authorize`, since its request does not prove which app sends it.

```sh
npx expo install accounts expo-secure-store expo-web-browser react-native-get-random-values viem
```

In React Native, `accounts`, `accounts/plugins`, and `accounts/expo` import `react-native-get-random-values`, so an app installs it as a dependency of its own, with or without Expo. It is a native module, and React Native links only the native modules that the app's own `package.json` names.

```tsx
import { Accounts } from 'accounts'
import { expo } from 'accounts/expo'
import { viem } from 'accounts/plugins'
import { react } from 'accounts/react'
import { Button, Text } from 'react-native'
import { Expiry, Scopes } from 'viem/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

const tempoId = Accounts.create({
  // The app's access key may transfer up to 100 OUSD for 30 days.
  accessKey: () => ({
    expiry: Expiry.days(30),
    limits: [{ limit: 100_000_000n, token: ousd }],
    scopes: [Scopes.tip20(ousd).transfer()],
  }),
  clientId: 'client_…',
  plugins: [
    // 1. The secure store holds the session, and the sheet shows Tempo ID's pages.
    expo({ redirectUri: 'com.example.app:/callback' }),
    // 2. `tempoId.useSession()` renders the session.
    react(),
    viem(),
  ],
})

export function App() {
  const { session } = tempoId.useSession()
  if (!session)
    return <Button onPress={() => tempoId.redirect.signIn()} title="Sign in" />
  return <Text>Signed in as {session.user.email}</Text>
}
```

1. [`redirect.signIn`](../api/plugins.redirect.md#redirectsignin) builds the URL, and the preset shows it in a sheet, such as `ASWebAuthenticationSession` on iOS. The sign-in then redeems the code, and sets the session. It returns `undefined` when the user dismisses the sheet. The access key is a secp256k1 private key, so the secure store holds the session.
2. [`tempoId.useSession()`](../api/react.react.md) reads the saved session on the first render, as [React](react.md) describes.

[`examples/mobile`](../../examples/mobile/App.tsx) runs this flow, and sends OUSD with the session's access key. A React Native app without Expo uses [`redirect`](../api/plugins.redirect.md) with its own `open`, and a [`store`](../api/Accounts.from.md) of its own.

## Recipes

### Sign out

A native app holds no Tempo ID session cookie, so the request that ends a browser's session ends none for it. [`tempoId.signOut`](../api/Accounts.create.md#signout) also revokes the saved refresh token at `POST /oauth2/revoke`, and empties the session at once. The sheet's browser keeps its own session.

```ts
await tempoId.signOut()
```

> [!WARNING]
> Do not delete the saved session without `signOut`. The refresh token stays valid until the end of the app's [refresh token lifetime](https://github.com/tempoxyz/id/blob/main/docs/access-tokens.md#refresh-token-lifetime), which can be `never`.

## Learn more

- [Sessions](sessions.md)
- [React](react.md)
- [Redirect sign-in](redirect.md)
- [`expo`](../api/plugins.expo.md)
- [`redirect`](../api/plugins.redirect.md)
