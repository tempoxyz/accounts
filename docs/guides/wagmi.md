# wagmi

## Overview

A wagmi app connects to Tempo ID with the [`tempoId`](../api/wagmi.tempoId.md) connector from `accounts/wagmi`, or takes a config from its own instance with the [`wagmi`](../api/wagmi.wagmi.md) plugin, as [Use the instance's config](#use-the-instances-config) describes. The connector's wallet is a Tempo ID instance: a sign-in connects, and a sign-out disconnects. wagmi's actions and hooks then sign with the session's access key, as the [`viem`](../api/plugins.viem.md) plugin does.

```sh
npm i accounts @wagmi/core viem
```

```ts
import { tempoId } from 'accounts/wagmi'
import { connect, createConfig, disconnect, http } from '@wagmi/core'
import { Actions } from '@wagmi/core/tempo'
import { tempo } from 'viem/tempo/chains'
import * as Tokens from 'viem/tokens'

const ousd = Tokens.ousd(tempo.id).address

// 1. The connector's instance uses the config's first chain.
const config = createConfig({
  chains: [tempo],
  connectors: [
    tempoId({
      accessKey: () => ({
        expiry: '1d',
        limits: [{ limit: '10', token: 'ousd' }],
      }),
    }),
  ],
  transports: { [tempo.id]: http() },
})
const connector = config.connectors[0]!

// 2. A connection signs in through the dialog, and requests a key.
button.onclick = async () => {
  const { accounts } = await connect(config, { connector })

  // 3. The access key signs the transfer.
  await Actions.token.transferSync(config, {
    amount: 10_000n,
    to: '0x…',
    token: ousd,
  })

  // 4. A disconnection signs the user out.
  await disconnect(config)
}
```

1. [`tempoId`](../api/wagmi.tempoId.md) takes the options of [`Accounts.create`](../api/Accounts.create.md) but `chainId`, and adds the `viem` plugin over the config's `chains` and `transports`. A `viem` plugin in `plugins`, such as `viem({ feeToken })`, sets that plugin's other options. In a browser, the page's origin serves as the client ID.
2. Without a sign-in plugin, the instance holds [`dialog`](../api/plugins.dialog.md), so `connect` runs `dialog.signIn`. Call it in a click handler. The connector's `accessKey` requests the access key.
3. wagmi's actions use the instance's Viem client. Send tokens with the token actions of `@wagmi/core/tempo`, or the `Hooks.token` hooks of `wagmi/tempo`, not with a hand-built ABI call. The access key attaches its key authorization to the first transaction, which registers the access key.
4. `disconnect` calls [`accounts.signOut`](../api/Accounts.create.md#signout).

## Recipes

### Use the instance's config

The [`wagmi`](../api/wagmi.wagmi.md) plugin adds `accounts.wagmi`, a config whose one connector is the app's own instance. The config holds Tempo's chains and the instance's chain, each with the chain and transport of the Viem client's options, with the instance's chain first. The plugin adds the Viem client itself, as `viem()` does, unless `plugins` holds a `viem` plugin, such as one with a `feeToken`. A call returns a config with overrides, as `accounts.viem` does for a client.

```tsx
import { Accounts } from 'accounts'
import { passkey, viem } from 'accounts/plugins'
import { wagmi } from 'accounts/wagmi'
import { WagmiProvider } from 'wagmi'

const accounts = Accounts.create({
  accessKey,
  // `viem()` is optional. `wagmi()` adds one with its defaults.
  plugins: [passkey(), viem(), wagmi()],
})

// The default config, the same at each read.
<WagmiProvider config={accounts.wagmi}>…</WagmiProvider>

// A new config with overrides.
const config = accounts.wagmi({ connectors: [injected()], ssr: true })
```

The app keeps one instance, so a sign-in through `accounts.passkey.signIn` connects wagmi, and `accounts.signOut` disconnects it.

### Sign in with a passkey

The first plugin of `plugins` that signs in without input runs at `connect`: `device`, `dialog`, `passkey`, or `redirect`.

```ts
import { passkey } from 'accounts/plugins'

const config = createConfig({
  chains: [tempo],
  connectors: [tempoId({ plugins: [passkey()] })],
  transports: { [tempo.id]: http() },
})
```

### Sign in with the app's own form

`signIn` replaces the sign-in of `connect`. It receives the instance and the call's `accessKey`. The `email` plugin takes the user's code, so it needs `signIn`. [`connector.getInstance()`](../api/wagmi.tempoId.md#getinstance) returns the instance for the steps before it, such as the code's email.

```ts
import { email } from 'accounts/plugins'

const config = createConfig({
  chains: [tempo],
  connectors: [tempoId({ plugins: [email()] })],
  transports: { [tempo.id]: http() },
})
const connector = config.connectors[0]!

const instance = await connector.getInstance()
await instance.email.sendCode({ email: address })

await connect(config, {
  connector,
  signIn: (instance, { accessKey }) =>
    instance.email.signIn({ accessKey, code, email: address }),
})
```

A form on the app's own page needs a first-party app, as [Custom sign-in UI](custom-ui.md) describes.

### Connect without an access key

`accessKey: false` connects without an access key. On a page, the account's owner signs messages and typed data, and a transaction throws [`Accounts.KeyRequiredError`](../api/errors.md#accountskeyrequirederror). `connect` reads the Tempo Account that Tempo ID selects for the app, since a session without an access key holds no address.

```ts
await connect(config, { accessKey: false, connector })
const signature = await signMessage(config, {
  message: 'Sign in to app.example.com',
})
```

### Restore the connection

The instance saves its session, so wagmi's `reconnect` connects again with no sign-in, also on the page that a redirect returns to. `WagmiProvider` from `wagmi` runs it as the page mounts.

```ts
import { reconnect } from '@wagmi/core'

await reconnect(config)
```

### Use another chain

A session and its access key belong to one chain, so `switchChain` to another chain throws `wagmi.ChainSwitchError`. Put the chain first in `chains`, such as Tempo testnet in development.

```ts
import { tempoTestnet } from 'viem/tempo/chains'

const config = createConfig({
  chains: [tempoTestnet],
  connectors: [tempoId()],
  transports: { [tempoTestnet.id]: http() },
})
```

## Learn more

- [`tempoId`](../api/wagmi.tempoId.md)
- [`wagmi`](../api/wagmi.wagmi.md)
- [Viem](viem.md)
- [Access keys](access-keys.md)
- [Redirect sign-in](redirect.md)
