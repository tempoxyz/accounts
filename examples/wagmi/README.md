# wagmi example

A wagmi app whose config is its Tempo ID instance's, from the `wagmi` plugin of `accounts/wagmi`. Connect signs in through Tempo ID's dialog and requests a key that sends up to 100 OUSD on Tempo testnet. wagmi's `useSendTransaction` then sends with that key, and Disconnect signs out. Its client ID is its origin, so it needs no registration. A localhost origin signs in only to a deployment for local development, such as `pnpm dev:app`.

```sh
pnpm --filter example-wagmi dev
```

Open `http://localhost:5191`. `VITE_TEMPO_ID_URL` names another deployment.
