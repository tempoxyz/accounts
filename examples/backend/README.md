# Backend example

A Cloudflare Worker that signs in with Tempo ID through a redirect, and sends OUSD on Tempo testnet with the session's access key. Each session lives in a Durable Object, so the browser holds only the session ID, in an `HttpOnly` cookie.

The Worker is a confidential app with a registered client ID and a client secret. Its redirect URI is the Worker's `/callback`, over `https`. A backend without a client secret can use its origin as its client ID instead, as [Backends without a client secret](https://github.com/tempoxyz/id/blob/main/docs/apps.md#backends-without-a-client-secret) describes.

Register the app:

```sh
pnpm tempo-id admin login
pnpm tempo-id admin apps post --name "Backend example" --redirect-uris https://tempo-id-example-backend.<subdomain>.workers.dev/callback --secret true --format json
```

Set the client ID and the secret that the command returns, and set `TEMPO_ID_URL` in `wrangler.jsonc` to the deployment that registered the app. Then deploy the Worker:

```sh
pnpm --filter example-backend exec wrangler secret put CLIENT_ID
pnpm --filter example-backend exec wrangler secret put CLIENT_SECRET
pnpm --filter example-backend exec wrangler deploy
```
