<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="accounts" src=".github/logo-light.svg" width="auto" height="100">
  </picture>
</p>

<p align="center"><b>Accounts SDK for Apps and Wallets building on Tempo.</b></p>

<p align="center">
  <a href="#install">Install</a> · <a href="#documentation">Documentation</a> · <a href="#examples">Examples</a> · <a href="#development">Development</a> · <a href="#license">License</a>
</p>

---

## Install

```bash
npm i accounts
```

```bash
pnpm i accounts
```

```bash
bun i accounts
```

## Documentation

For documentation and guides, visit [docs.tempo.xyz/accounts](https://docs.tempo.xyz/accounts).

## Examples

| Example                                                                 | Description                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [basic](./examples/basic)                                               | Wagmi-based setup using the `tempoWallet` connector to connect to Tempo Wallets.  |
| [cli](./examples/cli)                                                   | Minimal CLI setup to connect and authorize local keys using Tempo Wallets.        |
| [domain-bound-webauthn](./examples/domain-bound-webauthn)               | Domain-bound passkey example using Wagmi and the `webAuthn` connector.            |
| [with-access-key](./examples/with-access-key)                           | Authorize access keys using Tempo Wallets to submit transactions without prompts. |
| [with-access-key-and-webauthn](./examples/with-access-key-and-webauthn) | Authorize access keys using domain-bound Passkeys.                                |
| [with-fee-payer](./examples/with-fee-payer)                             | Sponsor transactions via Tempo Wallets.                                           |
| [with-fee-payer-and-webauthn](./examples/with-fee-payer-and-webauthn)   | Sponsor transactions using a Cloudflare Worker with domain-bound Passkeys.        |

## Development

```sh
pnpm dev              # start dialog + dialog-ref + web playground dev servers
pnpm dev:cli          # start the CLI playground client
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

### Playgrounds

| Playground                   | Command          | Description                                  |
| ---------------------------- | ---------------- | -------------------------------------------- |
| [web](./playgrounds/web)     | `pnpm dev`       | Web playground for dialog + adapter testing. |
| [wagmi](./playgrounds/wagmi) | `pnpm dev:wagmi` | Wagmi-based playground with connectors.      |
| [cli](./playgrounds/cli)     | `pnpm dev:cli`   | CLI playground for device-code auth flow.    |

### Reference Implementations

The `ref-impls/` directory contains reference implementations for building on the Account SDK:

| Directory             | Description                                                                                                                                                                              |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ref-impls/dialog/`   | Minimal, unstyled embed dialog app demonstrating how to build a custom embed using the `Remote` API. Select `dialogRefImpl` in the web playground's adapter dropdown to test against it. |
| `ref-impls/cli-auth/` | Minimal React + Cloudflare/Vite host reference for device-code CLI auth: built-in code-auth endpoints plus a single unstyled approval screen and local smoke client.                     |

## License

MIT
