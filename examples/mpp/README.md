# MPP Example

Demonstrates [Machine Payment Protocol (MPP)](https://mpp.dev) integration with
the Tempo Accounts SDK. The browser auto-pays HTTP `402 Payment Required` challenges
served by a [Hono](https://hono.dev/) server using the
[`mppx/hono`](https://github.com/wevm/mppx) middleware.

MPP support is enabled by default on the Tempo Accounts SDK provider — no extra
client-side configuration is required.

## Intents

Two [intents](https://mpp.dev) are demonstrated, both served from a single
Hono `app` powered by `mppx/hono`:

| Endpoint           | Intent          | Cost         | Notes                                                                        |
| ------------------ | --------------- | ------------ | ---------------------------------------------------------------------------- |
| `GET /api/auth`    | **zero-charge** | $0           | Replay-protected proof of account ownership. No on-chain transaction.        |
| `GET /api/fortune` | **charge**      | $0.01 / call | One-shot pathUSD transfer, settled on-chain before the response is returned. |

## Setup

```bash
npx gitpick tempoxyz/accounts/examples/mpp
npm i
npm dev
```

Sign in with a Tempo Wallet account on testnet, then click each intent button
to watch the SDK auto-pay the 402 challenge and return the protected payload.

## How it works

The worker (`worker/index.ts`) configures an MPP handler with the `tempo()`
payment method:

```ts
import { Hono } from 'hono'
import { Mppx, tempo } from 'mppx/hono'
import { privateKeyToAccount } from 'viem/accounts'

const account = privateKeyToAccount('0x...')

const mppx = Mppx.create({
  methods: [tempo({ account, currency: '0x...', feePayer: true, testnet: true })],
  realm: 'mpp',
  secretKey: '...',
})

const app = new Hono()
app.get('/api/fortune', mppx.charge({ amount: '0.01' }), (c) => c.json({ fortune: '...' }))
app.get('/api/auth',    mppx.charge({ amount: '0' }),    (c) => c.json({ ok: true }))
```

On the client, the standard `tempoWallet()` connector is enough — the
`Provider.create({ mpp: true })` default automatically intercepts the 402
responses, signs the payment with the connected account, and retries the
original request with the credential attached.

For pull-mode charge credentials, `feePayer: true` lets the worker co-sign and
broadcast the signed payment transaction. Without a fee payer, the worker can
verify the credential shape but cannot pay the transaction fee needed to settle
the charge on-chain.
