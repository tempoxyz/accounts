# React Native Playground

## Production wallet

```sh
pnpm install
cd playgrounds/react-native
pnpm ios:prod
```

This targets the default Tempo Wallet (`https://wallet.tempo.xyz`) and publishes
the local consumer discovery document through a Cloudflare quick tunnel
(`cloudflared` must be installed) so the production wallet can verify it. The
tunnel closes when the dev server exits.

## Local wallet

```sh
EXPO_PUBLIC_WALLET_HOST=http://localhost:21260 \
pnpm ios
```

`pnpm ios` starts a local consumer discovery server at
`http://localhost:21261/.well-known/urpc/consumer.json` and points the app at it
with `EXPO_PUBLIC_WALLET_CONSUMER_URL`.

Use `EXPO_PUBLIC_WALLET_HOST` for the wallet web app origin (defaults to
`https://wallet.tempo.xyz`). Set `TUNNEL=1` to publish the consumer through a
quick tunnel, or set `CONSUMER_PORT` / `EXPO_PUBLIC_WALLET_CONSUMER_URL`
explicitly to supply your own consumer origin.

The wallet must allow the playground callback URI:

```txt
xyz.tempo.accounts.playground:/auth
```
