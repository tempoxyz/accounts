# Subscriptions Example

Demonstrates the [MPP `subscription` intent](https://mpp.dev) with the Accounts
SDK. The server gates a route behind a recurring pathUSD subscription, and the
SDK auto-fulfills the `402 Payment Required` challenge by signing a recurring
access key authorization with the connected account.

Subsequent requests within the billing period reuse the active subscription
(no wallet prompt, no on-chain transaction). When the period elapses, the
server uses the recurring access key to bill the next period automatically.

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/subscriptions
cp .env.example .env
npm i
npm dev
```

Sign in with a Tempo Wallet account on testnet, click **Fund Account** to mint
some pathUSD, then click **GET /api/articles** to subscribe.

## How it works

`GET /api/articles` is gated by `mppx.subscription({})` from the
[`mppx/hono`](https://github.com/wevm/mppx) middleware. The first request
responds with a `402 Payment Required` challenge describing the subscription
plan (amount, currency, recipient, period, expiry). The Accounts SDK
automatically:

1. Asks the wallet to authorize a recurring access key bound to the plan via
   `wallet_authorizeAccessKey`.
2. Submits the signed key authorization as a `subscription` credential.
3. Retries the original request with the credential attached.

```http
GET /api/articles
  X-Subscriber: 0x…

→ 402 Payment Required
  WWW-Authenticate: Payment id="…", method="tempo", intent="subscription", …

→ (SDK signs a recurring key authorization, then retries)

GET /api/articles
  X-Subscriber: 0x…
  Authorization: Payment …

→ 200 OK
  { "articles": [ … ] }
```

The server records the subscription against the lookup key returned by
`resolve()` (here, the lowercased connected address). Subsequent requests with
the same `X-Subscriber` header are served immediately from the active
subscription. Once the billing period elapses, the server uses the stored
access key to bill the next period before serving the response.

See [`worker/index.ts`](./worker/index.ts) for the server-side configuration
and [`src/App.tsx`](./src/App.tsx) for the client.

## Notes

- The example uses an in-memory store (`Store.memory()`) so subscriptions
  reset whenever the worker restarts. In production, swap in a durable store
  (Cloudflare KV, Durable Objects, Postgres, etc.).
- The `X-Subscriber` header is used purely for demonstration. Real apps
  should derive the lookup key from a session cookie, JWT, or API key the
  server already trusts.
