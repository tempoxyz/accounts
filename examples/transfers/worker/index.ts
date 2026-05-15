import { Hono } from 'hono'
import { Mppx, tempo } from 'mppx/hono'
import { tempoModerato } from 'viem/chains'

const app = new Hono()

const mppx = Mppx.create({
  methods: [tempo()],
})

app.get(
  '/api/transfer',
  mppx.charge({
    amount: '0.01',
    chainId: tempoModerato.id,
    currency: '0x20c0000000000000000000000000000000000000',
    recipient: '0x0000000000000000000000000000000000000001',
  }),
  (c) =>
    c.json({
      success: true,
    }),
)

export default app
