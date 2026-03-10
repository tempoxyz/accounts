# Accounts SDK

Accounts toolchain for Tempo Wallets & Apps. 

[Metronome](https://metronome-git-main-tempoxyz.vercel.app/ideas/account-sdk)

## Install

```sh
pnpm i @tempoxyz/accounts
```

## Usage

### Vanilla JS

You can get set up with the Accounts SDK with pure JavaScript by using the 
`Provider` instance.

Internally, the `Provider` utilizes [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) to inject it's provider instance into
the page so it can be picked up by wallet connection dialogs on external web applications.

```tsx
import { Provider, webAuthn } from '@tempoxyz/accounts'
 
const provider = Provider.create({
  adapter: webAuthn(),
})

const { accounts } = await provider.request({ 
  method: 'wallet_connect'
})
```

### Viem

The Provider provides a Viem Client instance via the `getClient` accessor.

```tsx
import { Provider, webAuthn } from '@tempoxyz/accounts'
 
const provider = Provider.create({
  adapter: webAuthn(),
})

const client = provider.getClient()
```

### Wagmi

Use the `webAuthn` Wagmi connector to allow your Wagmi application to use WebAuthn-based
accounts.

```tsx
import { createConfig, http } from 'wagmi'
import { tempo } from 'wagmi/chains'
import { webAuthn } from '@tempoxyz/accounts/wagmi'
 
export const wagmiConfig = createConfig({
  chains: [tempo],
  connectors: [webAuthn()], 
  transports: {
    [tempo.id]: http(),
  },
})
```

## Adapters

| Adapter | Description |
| --- | --- |
| `connect` | Adapter for universal accounts, including [Tempo Wallet](https://wallet.tempo.xyz), orchestrated via [Tempo Connect](https://metronome-git-main-tempoxyz.vercel.app/ideas/tempo-connect) (an embedded iframe/popup dialog). |
| `webAuthn` | App-bound passkey accounts using WebAuthn registration and authentication flows. |
| `local` | Key agnostic adapter to define arbitrary account/key types and signing mechanisms. |

## License

MIT
