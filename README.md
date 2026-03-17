# tempodk

Accounts Development Kit for Tempo Wallets & Apps.

[Metronome](https://metronome-git-main-tempoxyz.vercel.app/ideas/account-sdk)

## Install

```sh
pnpm i tempodk
```

## Usage

### Vanilla JS

You can get set up with tempodk with pure JavaScript by using the
`Provider` instance.

Internally, the `Provider` utilizes [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) to inject it's provider instance into
the page so it can be picked up by wallet connection dialogs on external web applications.

```tsx
import { Provider } from 'tempodk'

const provider = Provider.create()

const { accounts } = await provider.request({
  method: 'wallet_connect',
})
```

### Viem

The Provider provides a Viem Client instance via the `getClient` accessor.

```tsx
import { Provider } from 'tempodk'

const provider = Provider.create()

const client = provider.getClient()
```

### Wagmi

Use the `tempoWallet` Wagmi connector to allow your Wagmi application to enable the Tempo Wallet dialog.

```tsx
import { createConfig, http } from 'wagmi'
import { tempo } from 'wagmi/chains'
import { tempoWallet } from 'tempodk/wagmi'

export const wagmiConfig = createConfig({
  chains: [tempo],
  connectors: [tempoWallet()],
  transports: {
    [tempo.id]: http(),
  },
})
```

## Adapters

| Adapter          | Description                                                                        |
| ---------------- | ---------------------------------------------------------------------------------- |
| `tempoWallet` 🚧 | Adapter for the Tempo Wallet dialog (an embedded iframe/popup dialog).             |
| `webAuthn`       | App-bound passkey accounts using WebAuthn registration and authentication flows.   |
| `local`          | Key agnostic adapter to define arbitrary account/key types and signing mechanisms. |

## Development

```sh
pnpm dev              # start auth + playground dev servers
pnpm dev:auth         # start auth app only
pnpm dev:playground   # start playground app only
pnpm dev:hosts        # start auth + playground instances on different TLDs
pnpm build            # build library
pnpm check            # lint + format
pnpm check:types      # type checks
pnpm test             # run tests
```

> `pnpm dev:hosts` starts three dev servers on different domains for cross-origin testing:
>
> - `https://auth.local:5174`
> - `https://playground.a:5173`
> - `https://playground.b:5175`

## License

MIT
