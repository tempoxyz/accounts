import { Fetch } from 'mppx/client'
import { Mppx as ServerMppx, tempo } from 'mppx/server'
import { parseUnits } from 'viem'
import { Addresses } from 'viem/tempo'
import { Actions } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vp/test'

import { headlessWebAuthn } from '../../test/adapters.js'
import { accounts, chain, getClient } from '../../test/config.js'
import { type Server, createServer } from '../../test/utils.js'
import * as Expiry from './Expiry.js'
import * as Provider from './Provider.js'

const client = getClient()

const payment = ServerMppx.create({
  methods: [
    tempo({
      account: accounts[1]!,
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

afterEach(() => Fetch.restore())

describe('mppx integration', () => {
  test('polyfilled fetch handles 402 charge automatically', async () => {
    const provider = Provider.create({
      adapter: headlessWebAuthn(),
      chains: [chain],
      mpp: true,
    })

    const address = await connect(provider)
    await fund(address)

    const res = await fetch(`${server.url}/fortune`)
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body).toMatchInlineSnapshot(`
      {
        "fortune": "Your code will compile on the first try.",
      }
    `)
  })

  test('pull mode publishes a pending access key on first charge', async () => {
    const provider = Provider.create({
      adapter: headlessWebAuthn(),
      chains: [chain],
      mpp: { mode: 'pull' },
    })
    const address = await connect(provider)
    await fund(address)

    await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry: Expiry.days(1) }],
    })

    const key = provider.store.getState().accessKeys[0]!
    expect(key.keyAuthorization).toBeDefined()

    const res = await fetch(`${server.url}/fortune`)
    expect(res.status).toBe(200)
    expect(provider.store.getState().accessKeys[0]!.keyAuthorization).toBeUndefined()

    const metadata = await Actions.accessKey.getMetadata(client, {
      account: address,
      accessKey: key.address,
    })
    expect(metadata.isRevoked).toMatchInlineSnapshot(`false`)
  })

  test('pull mode keeps pending access key after failed verification', async () => {
    const failingServer = await createServer(async (req, res) => {
      if (req.headers.authorization) {
        res.writeHead(402, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ title: 'Verification Failed' }))
        return
      }

      await ServerMppx.toNodeListener(
        payment.charge({
          amount: '1',
        }),
      )(req, res)
    })

    try {
      const provider = Provider.create({
        adapter: headlessWebAuthn(),
        chains: [chain],
        mpp: { mode: 'pull' },
      })
      const address = await connect(provider)
      await fund(address)

      await provider.request({
        method: 'wallet_authorizeAccessKey',
        params: [{ expiry: Expiry.days(1) }],
      })

      const res = await fetch(`${failingServer.url}/fortune`)
      expect(res.status).toMatchInlineSnapshot(`402`)
      expect(provider.store.getState().accessKeys[0]!.keyAuthorization).toBeDefined()
    } finally {
      await failingServer.closeAsync()
    }
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

async function fund(address: `0x${string}`) {
  await Actions.token.transferSync(client, {
    account: accounts[0]!,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}
