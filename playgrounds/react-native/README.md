# React Native Playground

Run with the default Tempo Wallet:

```sh
pnpm install
cd playgrounds/react-native
pnpm ios
```

Run against another wallet origin:

```sh
EXPO_PUBLIC_WALLET_CONSUMER_URL=http://localhost:5176 \
EXPO_PUBLIC_WALLET_HOST=http://localhost:5176 \
pnpm ios
```

Use `EXPO_PUBLIC_WALLET_CONSUMER_URL` for the origin that serves this app's
consumer config. Use `EXPO_PUBLIC_WALLET_HOST` for the wallet web app origin.

The wallet must allow the playground callback URI:

```txt
xyz.tempo.accounts.playground:/auth
```
