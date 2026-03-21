import { Mppx as ServerMppx, tempo } from 'mppx/server'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { Actions } from 'viem/tempo'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { headlessWebAuthn } from '../../test/adapters.js'
import { accounts, chain, getClient } from '../../test/config.js'
import { type Server, createServer } from '../../test/utils.js'
import * as Provider from './Provider.js'

const recipient = accounts[1]!.address
const client = getClient()

const payment = ServerMppx.create({
  methods: [
    tempo({
      recipient,
      currency: Addresses.pathUsd,
      getClient: () => client,
    }),
  ],
  realm: 'mppx-test',
  secretKey: 'test-secret-key',
})

let server: Server

beforeAll(async () => {
  server = await createServer(async (req, res) => {
    const result = await ServerMppx.toNodeListener(
      payment.charge({
        amount: '1',
      }),
    )(req, res)
    if (result.status === 402) return
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ fortune: 'Your code will compile on the first try.' }))
  })
})

afterAll(() => server?.closeAsync())

describe('mppx integration', () => {
  test('polyfilled fetch handles 402 charge automatically', async () => {
    const provider = Provider.create({
      adapter: headlessWebAuthn(),
      chains: [chain],
      mpp: true,
    })

    const address = await connect(provider)

    const client = getClient()
    await Actions.token.transferSync(client, {
      account: accounts[0]!,
      feeToken: Addresses.pathUsd,
      to: address,
      token: Addresses.pathUsd,
      amount: parseUnits('10', 6),
    })

    const res = await fetch(`${server.url}/fortune`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toMatchInlineSnapshot(`
      {
        "fortune": "Your code will compile on the first try.",
      }
    `)
  })
})

async function connect(provider: ReturnType<typeof Provider.create>) {
  const login = await provider.request({ method: 'wallet_connect' })
  if (login.accounts.length > 0) return login.accounts[0]!.address
  const register = await provider.request({
    method: 'wallet_connect',
    params: [{ capabilities: { method: 'register' } }],
  })
  return register.accounts[0]!.address
}
