<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="accounts" src=".github/logo-light.svg" width="auto" height="100">
  </picture>
</p>

<p align="center"><b>Accounts SDK for Apps and Wallets building on Tempo.</b></p>

<p align="center">
  <a href="#quick-prompt">Quick Prompt</a> · <a href="#install">Install</a> · <a href="#documentation">Documentation</a> · <a href="#examples">Examples</a> · <a href="#development">Development</a> · <a href="#license">License</a>
</p>

---

## Quick Prompt

Prompt your agent:

```
Read docs.tempo.xyz/accounts and integrate Tempo Connect into my application
```

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

## Getting Help

Have questions or building something cool with the Accounts SDK?

Join the Telegram group to chat with the team and other devs: [@mpp_devs](https://t.me/mpp_devs)

## Examples

| Example                                                                 | Description                                                                       |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| [basic](./examples/basic)                                               | Wagmi-based setup using the `tempoConnect` connector to connect to Tempo Connect. |
| [cli](./examples/cli)                                                   | Minimal CLI setup to connect and authorize local keys using Tempo Connect.        |
| [domain-bound-webauthn](./examples/domain-bound-webauthn)               | Domain-bound passkey example using Wagmi and the `webAuthn` connector.            |
| [with-access-key](./examples/with-access-key)                           | Authorize access keys using Tempo Connect to submit transactions without prompts. |
| [with-access-key-and-webauthn](./examples/with-access-key-and-webauthn) | Authorize access keys using domain-bound Passkeys.                                |
| [with-fee-payer](./examples/with-fee-payer)                             | Sponsor transactions via Tempo Connect.                                           |
| [with-fee-payer-and-webauthn](./examples/with-fee-payer-and-webauthn)   | Sponsor transactions using a Cloudflare Worker with domain-bound Passkeys.        |

## Development

Requires [Docker](https://docs.docker.com/get-docker/) and [OrbStack](https://orbstack.dev/) (recommended on macOS for automatic HTTPS `.tempo.local` domains).

```sh
pnpm dev              # start all dev services via docker compose
pnpm dev:logs         # tail logs from all containers (or `pnpm dev:logs -- connect`)
pnpm dev:cli          # start the CLI playground client (runs on host)
pnpm build            # build library
pnpm check            # lint + format
pnpm check:types      # type checks
pnpm test             # run tests
```

### Services

| Service    | OrbStack URL                     |
| ---------- | -------------------------------- |
| playground | `https://playground.tempo.local` |
| connect    | `https://connect.tempo.local`    |
| dialog-ref | `https://dialog-ref.tempo.local` |
| wagmi      | `https://wagmi.tempo.local`      |

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

<sup>
Licensed under either of <a href="LICENSE-APACHE">Apache License, Version
2.0</a> or <a href="LICENSE-MIT">MIT license</a> at your option.
</sup>

<br>

<sub>
Unless you explicitly state otherwise, any contribution intentionally submitted
for inclusion in these packages by you, as defined in the Apache-2.0 license,
shall be dual licensed as above, without any additional terms or conditions.
</sub>
