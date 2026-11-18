<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/logo-dark.svg">
    <source media="(prefers-color-scheme: light)" srcset=".github/logo-light.svg">
    <img alt="accounts" src=".github/logo-light.svg" width="auto" height="100">
  </picture>
</p>

<p align="center"><b>Accounts SDK for Apps building on Tempo</b></p>

<p align="center">
  <a href="https://accounts.tempo.xyz">Website</a> · <a href="https://accounts.tempo.xyz/docs">Docs</a> · <a href="#install">Install</a> · <a href="#examples">Examples</a> · <a href="#development">Development</a>
</p>

---

## Quick Prompt

Prompt your agent:

```
Read accounts.tempo.xyz and integrate Tempo into my application
```

## Install

```bash
npm i accounts viem
```

```bash
pnpm i accounts viem
```

```bash
bun i accounts viem
```

## Usage

Create an instance with `Accounts.create`, and add a plugin from `accounts/plugins` for each sign-in method. Without a sign-in plugin, users sign in through Tempo ID in a dialog on the page:

```ts
import { Accounts } from 'accounts'
import { viem } from 'accounts/plugins'

const accounts = Accounts.create({
  // Each sign-in requests an access key that may spend up to 10 OUSD for a day.
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  },
  plugins: [viem()],
})

await accounts.dialog.signIn()
await accounts.pay({ amount, to, token })
```

## Documentation

Start at [accounts.tempo.xyz](https://accounts.tempo.xyz) for the product overview and integration guides. The documentation lives at [accounts.tempo.xyz/docs](https://accounts.tempo.xyz/docs).

## Getting Help

Have questions or building something cool with the Tempo Accounts SDK?

Join the Telegram group to chat with the team and other devs: [@mpp_devs](https://t.me/mpp_devs)

## Examples

| Example                                                   | Description                                                                                      |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| [web](./examples/web)                                     | Sign in through a dialog on the page, and send OUSD with the access key.                         |
| [authenticated-api](./examples/authenticated-api)         | Sign in through a dialog that the backend runs, call the app's API with a cookie, and pay OUSD.  |
| [wagmi](./examples/wagmi)                                 | Sign in through wagmi's `connect`, with the `tempoId` connector.                                 |
| [backend](./examples/backend)                             | Sign in through a redirect, with the session on a Cloudflare Worker.                             |
| [siwe](./examples/siwe)                                   | Sign in with a SIWE message that a Worker issues, and approve a deletion with another message.   |
| [siwe-pay](./examples/siwe-pay)                           | Pay and sign in with one click, with the `siwe` plugin's `auth` and a Worker in token mode.      |
| [mpp-subscription](./examples/mpp-subscription)           | Approve an MPP subscription once, which a merchant's Worker charges each period.                 |
| [sponsored-self-hosted](./examples/sponsored-self-hosted) | Send OUSD whose fees the app's own fee payer pays, through a guarded relay route.                |
| [sponsored-tempo-api](./examples/sponsored-tempo-api)     | Send OUSD whose fees the sponsor of the app's Tempo API key pays, through a guarded relay route. |
| [cli](./examples/cli)                                     | Sign in through the device grant, with a code approved in a browser.                             |
| [mobile](./examples/mobile)                               | Sign in through the system browser in an Expo app.                                               |
| [mpp-charge](./examples/mpp-charge)                       | Pay an MPP charge once, with a transfer that the access key signs.                               |
| [mpp-session](./examples/mpp-session)                     | Pay a metered API in an MPP session, over HTTP, SSE, and a WebSocket.                            |
| [mcp](./examples/mcp)                                     | Sign an agent in once for a paid MCP server, and pay each tool call with the access key.         |

## Playgrounds

[`tempoxyz/id`](https://github.com/tempoxyz/id) holds one playground per flow, which uses `accounts`, deployed beside `https://id.tempo.xyz`.

| Playground   | Directory                                                                                     | URL                                                                              |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| API          | [`playgrounds/api`](https://github.com/tempoxyz/id/tree/main/playgrounds/api)                 | [id-playground-api.tempo.xyz/me](https://id-playground-api.tempo.xyz/me)         |
| Backend      | [`playgrounds/backend`](https://github.com/tempoxyz/id/tree/main/playgrounds/backend)         | [id-playground-backend.tempo.xyz](https://id-playground-backend.tempo.xyz)       |
| CLI          | [`playgrounds/cli`](https://github.com/tempoxyz/id/tree/main/playgrounds/cli)                 | none                                                                             |
| Mobile       | [`playgrounds/mobile`](https://github.com/tempoxyz/id/tree/main/playgrounds/mobile)           | none                                                                             |
| Third-party  | [`playgrounds/third-party`](https://github.com/tempoxyz/id/tree/main/playgrounds/third-party) | none                                                                             |
| Wagmi        | [`playgrounds/wagmi`](https://github.com/tempoxyz/id/tree/main/playgrounds/wagmi)             | [id-playground-wagmi.tempo.xyz](https://id-playground-wagmi.tempo.xyz)           |
| Web          | [`playgrounds/web`](https://github.com/tempoxyz/id/tree/main/playgrounds/web)                 | [id-playground-web.tempo.xyz](https://id-playground-web.tempo.xyz)               |
| Web (Cash)   | [`playgrounds/web`](https://github.com/tempoxyz/id/tree/main/playgrounds/web)                 | [id-playground-web-cash.tempo.xyz](https://id-playground-web-cash.tempo.xyz)     |
| Web (Shared) | [`playgrounds/web`](https://github.com/tempoxyz/id/tree/main/playgrounds/web)                 | [id-playground-web-shared.tempo.xyz](https://id-playground-web-shared.tempo.xyz) |

Web (Cash) signs in to the Tempo Cash realm, and Web (Shared) to both realms.

To run the CLI playground against `https://id.tempo.xyz`, run its `main` prerelease with `pnpx`:

```sh
export TEMPO_ID_URL=https://id.tempo.xyz
pnpx @tempoxyz/example-id-cli@main login   # approve the code on /device
pnpx @tempoxyz/example-id-cli@main whoami  # print the signed-in account
pnpx @tempoxyz/example-id-cli@main fund    # fund the Tempo Account from the testnet faucet
pnpx @tempoxyz/example-id-cli@main send 0x000000000000000000000000000000000000dEaD 0.01
```

## Development

```sh
pnpm build            # build library
pnpm check            # lint + format
pnpm check:types      # type checks
pnpm test             # run tests
```

### Releases

Each push to `main` publishes to npm through trusted publishing, from `.github/workflows/release.yml`, as `<breaking>.<commit time>.<n>` under `latest`, such as `1.20261118194700.0`, so `accounts` installs the current commit of `main`, and a caret range resolves each later release. A breaking pull request title, such as `feat!:`, raises `<breaking>`. `scripts/release.ts` picks the version.

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
