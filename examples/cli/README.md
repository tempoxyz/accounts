# CLI example

A CLI that signs in with Tempo ID's device grant, and sends OUSD on Tempo testnet with the access key of the sign-in. It sends `cli:tempo-example` as its client ID, so it needs no registration. The session saves to `~/.config/tempo-example/session.json`, which only the user can read.

```sh
pnpm --filter example-cli start login
pnpm --filter example-cli start whoami
pnpm --filter example-cli start send 0x000000000000000000000000000000000000dEaD 0.01
pnpm --filter example-cli start logout
```

`TEMPO_ID_URL` names another deployment.
