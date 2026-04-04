# Tempo Accounts SDK

Accounts SDK for Tempo Wallets & Apps.

## Install

```sh
pnpm i accounts
```

## Usage

### Vanilla JS

You can get set up with the Accounts SDK with pure JavaScript by using the
`Provider` instance.

Internally, the `Provider` utilizes [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963) to inject it's provider instance into
the page so it can be picked up by wallet connection dialogs on external web applications.

```tsx
import { Provider } from 'accounts'

const provider = Provider.create()

const { accounts } = await provider.request({
  method: 'wallet_connect',
})
```

### Viem

The Provider provides a Viem Client instance via the `getClient` accessor.

```tsx
import { Provider } from 'accounts'

const provider = Provider.create()

const client = provider.getClient()
```

### Wagmi

Use the `tempoWallet` Wagmi connector to allow your Wagmi application to enable the Tempo Wallet dialog.

```tsx
import { createConfig, http } from 'wagmi'
import { tempo } from 'wagmi/chains'
import { tempoWallet } from 'accounts/wagmi'

export const wagmiConfig = createConfig({
  chains: [tempo],
  connectors: [tempoWallet()],
  transports: {
    [tempo.id]: http(),
  },
})
```

### CLI

Use the `accounts/cli` entrypoint when an external CLI already owns the local key material and only needs the Tempo Wallet browser flow to authenticate the user and authorize that key.

```ts
import { Provider } from 'accounts/cli'

const provider = Provider.create({
  serviceUrl: 'https://wallet.example.com/cli-auth',
})

const { accounts } = await provider.request({
  method: 'wallet_connect',
  params: [
    {
      capabilities: {
        authorizeAccessKey: {
          expiry: Math.floor(Date.now() / 1000) + 3600,
          publicKey: '0x...',
        },
      },
    },
  ],
})
```

## Adapters

| Adapter                  | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `dialog` / `tempoWallet` | Adapter for the Tempo Wallet dialog (an embedded iframe/popup dialog).             |
| `webAuthn`               | App-bound passkey accounts using WebAuthn registration and authentication flows.   |
| `cli`                    | Device-code based adapter for CLI authentication and access key authorization.     |
| `local`                  | Key agnostic adapter to define arbitrary account/key types and signing mechanisms. |

## Development

```sh
pnpm dev              # start dialog + dialog-ref + web playground dev servers
pnpm playground:cli   # run the CLI playground client
pnpm dev:dialog       # start Tempo Wallet dialog only
pnpm dev:dialog-ref   # start reference dialog implementation only (port 5174)
pnpm dev:playground   # start web playground only
pnpm dev:hosts        # start dialog + web playground instances on different TLDs
pnpm build            # build library
pnpm check            # lint + format
pnpm check:types      # type checks
pnpm test             # run tests
```

> `pnpm dev:hosts` starts three dev servers on different domains for cross-origin testing:
>
> - `https://app.moderato.tempo.local:3001`
> - `https://playground.a:5173`
> - `https://playground.b:5175`

### Reference Implementations

The `ref-impls/` directory contains reference implementations for building on the Account SDK:

| Directory             | Description                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref-impls/dialog/`   | Minimal, unstyled embed dialog app demonstrating how to build a custom embed using the `Remote` API. Select `dialogRefImpl` in the web playground's adapter dropdown to test against it. |
| `ref-impls/cli-auth/` | Minimal React + Cloudflare/Vite host reference for device-code CLI auth: built-in code-auth endpoints plus a single unstyled approval screen and local smoke client.                     |

## License

MIT
