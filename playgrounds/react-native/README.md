# React Native Playground

The playground uses Wata mobile web auth through the React Native
`tempoWallet()` adapter. By default, both the wallet host discovery origin and
the consumer discovery origin are `https://wallet.tempo.xyz`.

The default wallet origin must serve a consumer document that allows the
playground callback scheme.

```json
{
  "callback_urls": [
    "xyz.tempo.accounts.playground:/auth",
    "xyz.tempo.accounts.playground://auth"
  ],
  "id": "wallet.tempo.xyz",
  "name": "Tempo Wallet",
  "origin": "https://wallet.tempo.xyz",
  "version": "1.0"
}
```

To run against a different origin, set `EXPO_PUBLIC_WALLET_ORIGIN`. The custom
origin must serve both Wata discovery documents for the app and wallet roles,
and its consumer document must allow the playground callback scheme.

```
pnpm install
cd playgrounds/react-native
EXPO_PUBLIC_WALLET_ORIGIN=http://localhost:5176 pnpm ios
```
