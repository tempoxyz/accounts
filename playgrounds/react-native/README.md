# React Native Playground

Run with the default Tempo Wallet:

```sh
pnpm install
cd playgrounds/react-native
pnpm ios
```

The playground starts a local consumer discovery server at
`http://localhost:21261/.well-known/urpc/consumer.json` and points the app at it
with `EXPO_PUBLIC_WALLET_CONSUMER_URL`.

Run against another wallet origin:

```sh
EXPO_PUBLIC_WALLET_HOST=http://localhost:21260 \
pnpm ios
```

Use `EXPO_PUBLIC_WALLET_HOST` for the wallet web app origin. Use
`CONSUMER_PORT` or `EXPO_PUBLIC_WALLET_CONSUMER_URL` only when the wallet needs
a different consumer origin, such as a tunnel URL.

The wallet must allow the playground callback URI:

```txt
xyz.tempo.accounts.playground:/auth
```
