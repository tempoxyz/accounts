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

  test('pull mode publishes a pending access key authorization', async () => {
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

  test('pull mode attaches pending access key authorization and keeps it pending after failed verification', async () => {
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
      const requests: unknown[] = []
      const keyAuthorizations: unknown[] = []
      const provider = Provider.create({
        adapter: recordingHeadlessWebAuthn({ keyAuthorizations, requests }),
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

      const res = await fetch(`${failingServer.url}/fortune`)
      expect(res.status).toMatchInlineSnapshot(`402`)
      expect(
        keyAuthorizationValueAddresses(keyAuthorizations).map((address) => address.toLowerCase()),
      ).toEqual([key.address.toLowerCase()])
      expect(provider.store.getState().accessKeys[0]!.keyAuthorization).toBeDefined()

      const status = await provider.getAccessKeyStatus({ accessKey: key.address })
      expect(status).toMatchInlineSnapshot(`"pending"`)
    } finally {
      await failingServer.closeAsync()
    }
  })

  test('push mode attaches pending access key authorization and publishes it', async () => {
    const requests: unknown[] = []
    const provider = Provider.create({
      adapter: recordingHeadlessWebAuthn({ requests }),
      chains: [chain],
      mpp: { mode: 'push' },
    })
    const address = await connect(provider)
    await fund(address)

    await provider.request({
      method: 'wallet_authorizeAccessKey',
      params: [{ expiry: Expiry.days(1) }],
    })
    const key = provider.store.getState().accessKeys[0]!

    const res = await fetch(`${server.url}/fortune`)
    expect(res.status).toMatchInlineSnapshot(`200`)
    expect(keyAuthorizationAddresses(requests).map((address) => address.toLowerCase())).toEqual([
      key.address.toLowerCase(),
    ])
    expect(provider.store.getState().accessKeys[0]!.keyAuthorization).toBeUndefined()

    const status = await provider.getAccessKeyStatus({ accessKey: key.address })
    expect(status).toMatchInlineSnapshot(`"published"`)
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

function recordingHeadlessWebAuthn(options: {
  keyAuthorizations?: unknown[] | undefined
  requests: unknown[]
}) {
  const base = headlessWebAuthn()
  return ((parameters: Parameters<typeof base>[0]) => {
    const instance = base({
      ...parameters,
      getClient(options_client) {
        const client = parameters.getClient(options_client)
        return Object.assign({}, client, {
          async request(request: Parameters<typeof client.request>[0]) {
            options.requests.push(request)
            return await client.request(request)
          },
        })
      },
    })
    const signTransaction = instance.actions.signTransaction
    return {
      ...instance,
      actions: {
        ...instance.actions,
        async signTransaction(
          parameters: Parameters<typeof signTransaction>[0],
          request: Parameters<typeof signTransaction>[1],
        ) {
          options.keyAuthorizations?.push(parameters.keyAuthorization)
          return await signTransaction(parameters, request)
        },
      },
    }
  }) as typeof base
}

function keyAuthorizationAddresses(requests: readonly unknown[]): readonly string[] {
  return requests.flatMap((request) => {
    if (!request || typeof request !== 'object') return []
    const { method, params } = request as { method?: unknown; params?: unknown }
    if (method !== 'eth_fillTransaction') return []
    if (!Array.isArray(params)) return []
    const transaction = params[0]
    if (!transaction || typeof transaction !== 'object') return []
    const { keyAuthorization } = transaction as { keyAuthorization?: unknown }
    const address = keyAuthorizationAddress(keyAuthorization)
    return address ? [address] : []
  })
}

function keyAuthorizationValueAddresses(values: readonly unknown[]): readonly string[] {
  return values.flatMap((value) => {
    const address = keyAuthorizationAddress(value)
    return address ? [address] : []
  })
}

function keyAuthorizationAddress(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined
  const { address, keyId } = value as { address?: unknown; keyId?: unknown }
  if (typeof keyId === 'string') return keyId
  if (typeof address === 'string') return address
  return undefined
}
