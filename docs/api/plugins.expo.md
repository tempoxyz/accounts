# expo

## Overview

The preset of an Expo app, from `accounts/expo`. The preset has an entry of its own, since it imports Expo modules that only an Expo app installs, so a React Native app without Expo never resolves them. In React Native, `accounts`, `accounts/plugins`, and `accounts/expo` install `crypto.getRandomValues`, which access keys need and React Native lacks, through `react-native-get-random-values`, before any of their modules loads. An app that imports `viem` or `ox` before `accounts` imports `react-native-get-random-values` first, since their hash library reads `crypto` once as it loads. It returns two plugins:

- One that sets the instance's `store`, the device's secure store from `expo-secure-store`, and its `redirectUri`. The secure store holds the session, with its keys encoded to the characters that it accepts, and each value as ox's `Json`, which keeps a `bigint`.
- [`redirect`](plugins.redirect.md), whose `signIn` opens Tempo ID's pages in the system browser with `expo-web-browser`, and resolves with the session.

`expo-secure-store`, `expo-web-browser`, and `react-native-get-random-values` are optional peer dependencies of `accounts`, which an Expo app installs. Any React Native app installs `react-native-get-random-values`, since React Native links only the native modules that the app's own `package.json` names. Options that `Accounts.create` receives win over the preset's.

## Usage

```ts
import { Accounts } from 'accounts'
import { expo } from 'accounts/expo'

const accounts = Accounts.create({
  clientId: 'client_…',
  plugins: [expo({ redirectUri: 'com.example.app:/callback' })],
})

const session = await accounts.redirect.signIn()
```

## Parameters

### redirectUri

- **Type:** `string`

The app's redirect URI on its custom scheme, which the app's registration lists.

```ts
expo({ redirectUri: 'com.example.app:/callback' })
```

### ephemeral (optional)

- **Type:** `boolean`
- **Default:** `true`

Whether the system browser keeps no cookies on iOS. Each sign-in then asks again, and a sign-out in the app leaves no Tempo ID session in the browser.

```ts
expo({ ephemeral: false, redirectUri: 'com.example.app:/callback' })
```
