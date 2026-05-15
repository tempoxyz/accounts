import { Hono } from 'hono'
import { Mppx, tempo } from 'mppx/hono'
import { privateKeyToAccount } from 'viem/accounts'

const app = new Hono()

// The recipient account that receives charge payments. In production, load
// this from a secure binding (e.g. `process.env.RECIPIENT_PRIVATE_KEY`).
const account = privateKeyToAccount(
  '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
)

// Configure MPP with the Tempo payment method.
const mppx = Mppx.create({
  methods: [
    tempo({
      account,
      // pathUSD on Tempo testnet.
      currency: '0x20c0000000000000000000000000000000000000',
      testnet: true,
    }),
  ],
  realm: 'with-mpp',
  secretKey: 'dev-secret-key-change-me-in-production',
})

// 1) ZERO-CHARGE intent: $0 charge that proves the caller controls a Tempo
// account without transferring any funds. Useful as a free, replay-protected
// authentication step.
app.get('/api/auth', mppx.charge({ amount: '0' }), (c) =>
  c.json({ authenticated: true, message: 'Hello, paying customer.' }),
)

// 2) CHARGE intent: per-request payment. Each call costs $0.01 in pathUSD and
// settles on-chain before the response is returned.
app.get('/api/fortune', mppx.charge({ amount: '0.01' }), (c) =>
  c.json({
    fortune: 'Your code will compile on the first try.',
  }),
)

export default app
