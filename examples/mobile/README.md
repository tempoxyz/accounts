# Mobile example

An Expo app that signs in with Tempo ID in the system browser, keeps the session in the device's secure store, and sends OUSD on Tempo testnet with the access key of the sign-in. It uses `tempo-example-mobile`, the native app that `scripts/seed.ts` registers with the URL scheme of `app.json`.

```sh
pnpm --filter example-mobile ios
```

`EXPO_PUBLIC_TEMPO_ID_URL` names another deployment.
