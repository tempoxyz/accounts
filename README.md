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

### CLI Bootstrap

Use the `tempodk/cli` entrypoint when an external CLI already owns the local key material and only needs the Tempo Wallet browser flow to authenticate the user and authorize that key.

```ts
import { Provider } from 'tempodk/cli'

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

This adapter is bootstrap-only in v1. It supports `wallet_connect` and returns the root account plus `capabilities.keyAuthorization`, but it does not implement transaction or message signing.

### CLI Auth Server

Use `Handler.cliAuth` from `tempodk/server` to host the generic device-code protocol:

- `POST /cli-auth/device-code`
- `POST /cli-auth/poll/:code`
- `POST /cli-auth/authorize`

The create request uses snake_case fields:

- `pub_key` required
- `code_challenge` required
- `key_type` optional, defaults to `secp256k1` when omitted
- `expiry` optional, defaults via server policy
- `limits` optional, defaults via server policy
- `account` optional

This CLI device-code request shape is intentionally more permissive than the shared `wallet_authorizeAccessKey` SDK contract. Keep generic RPC semantics strict unless we explicitly choose an SDK-wide widening.

The poll response returns:

- `status`
- `account_address`
- `key_authorization`

The device-code protocol value is the raw 8-character code, for example `ABCDEFGH`. If you present it to a user, format it for display as `ABCD-EFGH`, but keep storage and URL/query values unformatted for compatibility with existing Tempo consumers.

### Local CLI Smoke Test

Use the dev-only harness below when you want to manually exercise the extracted `tempodk/cli` + `tempodk/server` flow before `tempo/app` adopts the new server primitives.

In one terminal, start the playground app and worker:

```sh
pnpm dev:playground
```

In a second terminal, run the CLI demo:

```sh
pnpm demo:cli-auth
```

What happens:

1. the demo creates or loads a local P256 access key from `tmp/cli-auth-demo/access-key.json`
2. it calls `Provider.create({ serviceUrl: 'https://localhost:5173/cli-auth' })`
3. your browser opens the playground CLI auth approval screen
4. the page shows the pending `pub_key`, `key_type`, `expiry`, and `limits`
5. click `Approve`
6. the demo prints the root account plus returned `capabilities.keyAuthorization`

Expected terminal output from the CLI demo looks like:

```json
{
  "account": "0x...",
  "keyAuthorization": {
    "address": "0x...",
    "chainId": "0x...",
    "keyType": "p256",
    "signature": {
      "type": "secp256k1"
    }
  }
}
```

This harness is intentionally minimal:

- it validates the extracted `tempodk/cli` + `tempodk/server` flow
- the demo implementation lives under `playground/` and is intentionally not the real Tempo Wallet UI
- it uses a fixed dev root account for approval
- it does not include login, funding, or passkey UX
- real wallet-backed testing is the next follow-up in `tempo/app`

## Adapters

| Adapter                  | Description                                                                        |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `dialog` / `tempoWallet` | Adapter for the Tempo Wallet dialog (an embedded iframe/popup dialog).             |
| `webAuthn`               | App-bound passkey accounts using WebAuthn registration and authentication flows.   |
| `local`                  | Key agnostic adapter to define arbitrary account/key types and signing mechanisms. |

## Development

```sh
pnpm dev              # start embed + embed-ref + playground dev servers
pnpm demo:cli-auth    # run the CLI smoke-test client from playground/scripts
pnpm dev:embed        # start Tempo Wallet embed only
pnpm dev:embed-ref    # start reference embed implementation only (port 5174)
pnpm dev:playground   # start playground app only
pnpm dev:hosts        # start embed + playground instances on different TLDs
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

### Embed Reference Implementation

The `embed-ref/` directory contains a minimal, unstyled reference implementation of the embed dialog app. It demonstrates how to build a custom embed using the Account SDK's `Remote` API.

Select `dialogRefImpl` in the playground's adapter dropdown to test against it.

## License

MIT
