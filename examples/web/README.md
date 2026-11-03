# Web example

A page that signs in with Tempo ID in a dialog, and sends OUSD on Tempo testnet with the access key of the sign-in. Its client ID is its origin, so it needs no registration. A localhost origin signs in only to a deployment for local development, such as `pnpm dev:app`.

```sh
pnpm --filter example-web dev
```

Open `http://localhost:5190`. `VITE_TEMPO_ID_URL` names another deployment.
