import { Hex } from 'ox'
import { http, createServer } from 'node:http'
import { describe, expect, test, afterAll, beforeAll } from 'vp/test'

import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import { bitgo } from './bitgo.js'

const address = '0x0000000000000000000000000000000000000001'
const other = '0x0000000000000000000000000000000000000002'

const stubSignature = Hex.concat(Hex.padLeft('0x11', 32), Hex.padLeft('0x22', 32), '0x1b')

describe('bitgo', () => {
  let server: ReturnType<typeof createMockServer>

  beforeAll(() => {
    server = createMockServer()
    return server.start()
  })

  afterAll(() => server?.close())

  test('default: createAccount discovers the wallet address and signs the digest', async () => {
    const { adapter, state } = setup(server)

    const result = await adapter.actions.createAccount(
      { digest: '0x1234', name: 'Ada' },
      { method: 'wallet_connect', params: undefined },
    )

    expect(state().signPayloads).toMatchInlineSnapshot(`
      [
        "0x1234",
      ]
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "accounts": [
          {
            "address": "0x0000000000000000000000000000000000000001",
            "label": "Ada",
          },
        ],
        "signature": "${stubSignature}",
      }
    `)
  })

  test('default: loadAccounts discovers wallet accounts for signing', async () => {
    const { adapter, state } = setup(server)

    await adapter.actions.loadAccounts(undefined, { method: 'wallet_connect', params: undefined })
    const result = await adapter.actions.signPersonalMessage(
      { address, data: '0x68656c6c6f' },
      { method: 'personal_sign', params: ['0x68656c6c6f', address] },
    )

    expect(state().signPayloads.length).toMatchInlineSnapshot(`1`)
    expect(result).toMatchInlineSnapshot(
      `"${stubSignature}"`,
    )
  })

  test('default: loadAccounts can provision an external access key', async () => {
    const { adapter, state } = setup(server)

    const result = await adapter.actions.loadAccounts(
      {
        authorizeAccessKey: {
          address: other,
          expiry: 123,
          keyType: 'secp256k1',
        },
      },
      { method: 'wallet_connect', params: undefined },
    )

    expect(state().signPayloads).toMatchInlineSnapshot(`
      [
        "0x219d0ef7a59d2a40d6ff9e115e32fb6b53eb7fa518ea3364b7b806990fad3944",
      ]
    `)
    expect(result.keyAuthorization).toBeDefined()
    expect(result.accounts[0]?.address).toMatchInlineSnapshot(
      `"0x0000000000000000000000000000000000000001"`,
    )
  })

  test('behavior: expired sessions clear provider accounts', async () => {
    const { adapter, store } = setup(server, { authenticated: false })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: BitGo session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('behavior: server session errors clear provider accounts', async () => {
    const { adapter, store } = setup(server, { signError: true })
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await expect(
      adapter.actions.signPersonalMessage(
        { address, data: '0x68656c6c6f' },
        { method: 'personal_sign', params: ['0x68656c6c6f', address] },
      ),
    ).rejects.toMatchInlineSnapshot('[Provider.DisconnectedError: BitGo session expired.]')

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })

  test('disconnect: clears provider accounts', async () => {
    const { adapter, store } = setup(server)
    store.setState({ accounts: [{ address }], activeAccount: 0 })

    await adapter.actions.disconnect!()

    expect(store.getState().accounts).toMatchInlineSnapshot(`[]`)
  })
})

type MockState = {
  signPayloads: Hex.Hex[]
}

function createMockServer() {
  let authenticated = true
  let signError = false
  const state: MockState = { signPayloads: [] }

  const httpServer = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
    })
    req.on('end', () => {
      if (req.url === '/api/v2/me') {
        if (!authenticated) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ user: { id: 'test' } }))
        return
      }

      if (req.url?.includes('/wallet/') && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(
          JSON.stringify({
            id: 'test-wallet',
            receiveAddress: { address },
          }),
        )
        return
      }

      if (req.url?.includes('/signmessage') && req.method === 'POST') {
        if (signError) {
          res.writeHead(401, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'unauthorized' }))
          return
        }
        const parsed = JSON.parse(body)
        state.signPayloads.push(parsed.message.messageRaw)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ signature: stubSignature }))
        return
      }

      res.writeHead(404)
      res.end()
    })
  })

  let port = 0
  return {
    get url() {
      const addr = httpServer.address()
      if (typeof addr === 'object' && addr) return `http://localhost:${addr.port}`
      return `http://localhost:${port}`
    },
    start() {
      return new Promise<void>((resolve) => {
        httpServer.listen(0, () => {
          const addr = httpServer.address()
          if (typeof addr === 'object' && addr) port = addr.port
          resolve()
        })
      })
    },
    close() {
      httpServer.close()
    },
    configure(opts: { authenticated?: boolean; signError?: boolean }) {
      authenticated = opts.authenticated ?? true
      signError = opts.signError ?? false
      state.signPayloads = []
    },
    state() {
      return state
    },
  }
}

function setup(
  server: ReturnType<typeof createMockServer>,
  opts: { authenticated?: boolean; signError?: boolean } = {},
) {
  server.configure(opts)
  const storage = Storage.memory()
  const store = Store.create({ chainId: 1, storage })
  const adapter = bitgo({
    accessToken: 'v2x-test',
    coin: 'hteth',
    walletId: 'test-wallet',
    walletPassphrase: 'pass',
    env: server.url,
  })({
    getAccount: (() => {
      throw new Error('not implemented')
    }) as never,
    getClient: (() => ({ chain: { id: 1 } })) as never,
    storage,
    store,
  })
  return { adapter, store, state: () => server.state() }
}
