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

> [!WARNING]
> `accounts@1` is in alpha, under the `alpha` dist-tag. Its API is not stable yet.

## Quick Prompt

Prompt your agent:

```
Read accounts.tempo.xyz and integrate Tempo into my application
```

## Install

```bash
npm i accounts@alpha viem
```

```bash
pnpm i accounts@alpha viem
```

```bash
bun i accounts@alpha viem
```

## Usage

Create an instance with `Id.create`, and add a plugin from `accounts/plugins` for each sign-in method. Without a sign-in plugin, users sign in through Tempo ID in a dialog on the page:

```ts
import { Id } from 'accounts'
import { viem } from 'accounts/plugins'

const tempoId = Id.create({
  // Each sign-in requests an access key that may spend up to 10 OUSD for a day.
  accessKey: {
    expiry: '1d',
    limits: [{ limit: '10', token: 'ousd' }],
  },
  plugins: [viem()],
})

await tempoId.dialog.signIn()
await tempoId.token.transferSync({ amount, to, token })
```

## Documentation

Start at [accounts.tempo.xyz](https://accounts.tempo.xyz) for the product overview, live demos, and integration guides. The documentation lives at [accounts.tempo.xyz/docs](https://accounts.tempo.xyz/docs).

## Getting Help

Have questions or building something cool with the Tempo Accounts SDK?

Join the Telegram group to chat with the team and other devs: [@mpp_devs](https://t.me/mpp_devs)

## Examples

| Example                         | Description                                                             |
| ------------------------------- | ----------------------------------------------------------------------- |
| [web](./examples/web)           | Sign in through a dialog on the page, and send OUSD with the access key. |
| [wagmi](./examples/wagmi)       | Sign in through wagmi's `connect`, with the `tempoId` connector.        |
| [backend](./examples/backend)   | Sign in through a redirect, with the session on a Cloudflare Worker.    |
| [cli](./examples/cli)           | Sign in through the device grant, with a code approved in a browser.    |
| [mobile](./examples/mobile)     | Sign in through the system browser in an Expo app.                      |

## Development

```sh
pnpm build            # build library
pnpm check            # lint + format
pnpm check:types      # type checks
pnpm test             # run tests
```

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
