# wagmi

## Overview

A plugin, from `accounts/wagmi`, that adds `accounts.wagmi`: a [wagmi](https://wagmi.sh) config whose one connector is the instance itself. The config holds Tempo's chains and the instance's chain, each from the options of the [`viem`](plugins.viem.md) plugin, with the instance's chain first. Without a `viem` plugin in `plugins`, the plugin adds the Viem client itself, as `viem()` does, so the instance holds `accounts.viem` and its actions. An app that needs other options of the client, such as a `feeToken`, passes `viem({ … })` beside it. `@wagmi/core` is an optional peer dependency of `accounts`, so an app with wagmi installs it beside the package.

The connector is the [`tempoId`](wagmi.tempoId.md) connector over the app's own instance. `connect` signs in with the first plugin that signs in without input, `disconnect` signs out, and a sign-in or sign-out through the instance connects or disconnects wagmi.

| Member                  | Returns                                                                           |
| ----------------------- | --------------------------------------------------------------------------------- |
| `accounts.wagmi`        | The default config, created at its first read. Each read returns the same config. |
| `accounts.wagmi()`      | The default config.                                                               |
| `accounts.wagmi({ … })` | A new config with the overrides, such as `ssr` or other connectors.               |

## Usage

```tsx
import { Accounts } from 'accounts'
import { passkey } from 'accounts/plugins'
import { wagmi } from 'accounts/wagmi'
import { WagmiProvider } from 'wagmi'

const accounts = Accounts.create({
  accessKey,
  plugins: [passkey(), wagmi()],
})

function App() {
  return <WagmiProvider config={accounts.wagmi}>…</WagmiProvider>
}
```

## Return type

`Plugin<'wagmi'>`

The plugin adds one member to the instance:

### wagmi

- **Type:** `wagmi.Namespace`

The default config, which a call configures. A call without overrides returns the default config. A call with overrides returns a new config, whose connector is a new connector over the same instance.

```ts
const config = accounts.wagmi({ ssr: true })
```

## Parameters

The plugin's options set the default config. A call's overrides take the same options, and win over the plugin's.

### connectors (optional)

- **Type:** `readonly CreateConnectorFn[]`
- **Default:** `[]`

The connectors after the instance's, such as injected wallets. A call's `connectors` replace the plugin's.

### multiInjectedProviderDiscovery (optional)

- **Type:** `boolean`
- **Default:** `false`

Whether the config adds a connector for each wallet that announces itself on the page. The default leaves them out, so the config holds only Tempo ID.

### ssr (optional), storage (optional), syncConnectedChain (optional)

- **Type:** as wagmi's `createConfig` takes them
- **Default:** wagmi's

```ts
wagmi({ connectors: [injected()], ssr: true })
```

## Errors

### `Error`

`Accounts.create` throws when the instance's `chainId` is not a Tempo chain and the Viem client's options name no `chain` of that ID.

The connector throws the errors of [`tempoId`](wagmi.tempoId.md#errors).
