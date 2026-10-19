import { Hono } from 'hono'
import { Mppx, tempo } from 'mppx/hono'
import { tempoModerato } from 'viem/tempo/chains'
import { pathusd } from 'viem/tokens'

const app = new Hono()

const mppx = Mppx.create({
  methods: [tempo.charge()],
  secretKey: 'dev-secret-key-change-me-in-production',
})

app.get(
  '/api/transfer',
  mppx.charge({
    amount: '0.01',
    chainId: tempoModerato.id,
    currency: pathusd(42431).address,
    recipient: '0x0000000000000000000000000000000000000001',
  }),
  (c) =>
    c.json({
      success: true,
    }),
)

export default app
