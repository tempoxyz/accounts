import { parseUnits, type Address } from 'viem'
import { verifyMessage } from 'viem/actions'
import { Actions, Addresses } from 'viem/tempo'
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from 'vp/test'

import * as Authenticator from '../../../test/authenticator.js'
import { accounts, chain, getClient } from '../../../test/config.js'
import { createServer, type Server } from '../../../test/utils.js'
import * as Handler from '../../server/Handler.js'
import * as Kv from '../../server/Kv.js'
import * as Expiry from '../Expiry.js'
import * as Provider from '../Provider.js'
import * as Storage from '../Storage.js'
import * as Store from '../Store.js'
import * as WebAuthnCeremony from '../WebAuthnCeremony.js'
import { webAuthn } from './webAuthn.js'

const origin = 'http://localhost'
const latency = 300

/** Server requests in order, with start/end `performance.now()` timestamps. */
const requests: { end: number; path: string; start: number }[] = []
let server: Server

beforeAll(async () => {
  const handler = Handler.webAuthn({
    kv: Kv.memory(),
    origin,
    path: '/webauthn',
    rpId: 'localhost',
  })
  server = await createServer(async (req, res) => {
    const entry = { end: 0, path: new URL(req.url!, origin).pathname, start: performance.now() }
    requests.push(entry)
    // Simulated network latency so ceremony ordering is observable.
    await new Promise((resolve) => setTimeout(resolve, latency))
    res.on('finish', () => (entry.end = performance.now()))
    handler.listener(req, res)
  })
})

afterAll(async () => {
  await server.closeAsync()
})

afterEach(() => {
  requests.length = 0
  vi.unstubAllGlobals()
})

function setup(
  options: {
    authenticator?: ReturnType<typeof Authenticator.create> | undefined
    storage?: Storage.Storage | undefined
  } = {},
) {
  const authenticator = options.authenticator ?? Authenticator.create({ origin, rpId: 'localhost' })
  const storage = options.storage ?? Storage.memory()
  const window = Object.assign(new EventTarget(), {
    location: { hostname: 'localhost', origin },
    navigator: { credentials: authenticator.credentials },
  })
  vi.stubGlobal('window', window)
  const provider = Provider.create({
    adapter: webAuthn({ ceremony: WebAuthnCeremony.server({ url: `${server.url}/webauthn` }) }),
    chains: [chain],
    storage,
  })
  return { authenticator, provider, storage }
}

async function fund(address: Address) {
  await Actions.token.transferSync(getClient(), {
    account: accounts[0]!,
    amount: parseUnits('10', 6),
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
  })
}

function paths() {
  return requests.map((request) => request.path.replace(/^\/webauthn/, ''))
}

describe('wallet_connect register + personalSign', () => {
  test('behavior: signs the message while the server verifies registration', async () => {
    const { authenticator, provider } = setup()
    const message = 'Sign in to localhost\nNonce: 1234'

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'alice', personalSign: { message } } }],
    })

    expect(paths()).toMatchInlineSnapshot(`
      [
        "/register/options",
        "/register",
      ]
    `)
    expect(authenticator.calls.map((call) => call.method)).toMatchInlineSnapshot(`
      [
        "create",
        "get",
      ]
    `)

    // The message prompt opens before `/register` responds.
    const register = requests.find((request) => request.path.endsWith('/register'))!
    const get = authenticator.calls.find((call) => call.method === 'get')!
    expect(get.time < register.end).toMatchInlineSnapshot(`true`)

    // The signature is valid for the new account on localnet.
    const account = result.accounts[0]!
    const { signature } = account.capabilities
    const valid = await verifyMessage(getClient(), {
      address: account.address,
      message,
      signature: signature!,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})

describe('wallet_connect register, then register + authorizeAccessKey', () => {
  test('behavior: signs the key authorization locally without re-authenticating', async () => {
    const { authenticator, provider } = setup()

    const registered = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'bob' } }],
    })
    requests.length = 0
    authenticator.calls.length = 0

    const result = await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: { expiry: Expiry.days(1) },
            method: 'register',
            name: 'bob',
          },
        },
      ],
    })

    // No `/login/options` or `/login` round trips; one passkey prompt signs the
    // key authorization.
    expect(paths()).toMatchInlineSnapshot(`[]`)
    expect(authenticator.calls.map((call) => call.method)).toMatchInlineSnapshot(`
      [
        "get",
      ]
    `)
    expect(result.accounts[0]!.address).toBe(registered.accounts[0]!.address)
    expect(await provider.request({ method: 'eth_accounts' })).toHaveLength(1)

    // The access key works on localnet: the next transaction signs with it
    // instead of prompting for the passkey.
    await fund(result.accounts[0]!.address)
    const receipt = await provider.request({
      method: 'eth_sendTransactionSync',
      params: [
        {
          calls: [
            Actions.token.transfer.call({
              amount: parseUnits('1', 6),
              to: '0x0000000000000000000000000000000000000001',
              token: Addresses.pathUsd,
            }),
          ],
          feeToken: Addresses.pathUsd,
        },
      ],
    })
    expect(receipt.status).toMatchInlineSnapshot(`"0x1"`)
    expect(authenticator.calls.map((call) => call.method)).toMatchInlineSnapshot(`
      [
        "get",
      ]
    `)
  })

  test('behavior: re-authenticates when a later registration took over the session', async () => {
    const { authenticator, provider } = setup()

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'frank' } }],
    })
    // Registering another credential replaces the server session.
    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'grace' } }],
    })
    requests.length = 0
    authenticator.calls.length = 0

    await provider.request({
      method: 'wallet_connect',
      params: [
        {
          capabilities: {
            authorizeAccessKey: { expiry: Expiry.days(1) },
            method: 'register',
            name: 'frank',
          },
        },
      ],
    })

    expect(paths()).toMatchInlineSnapshot(`
      [
        "/login/options",
        "/login",
      ]
    `)
  })

  test('behavior: re-authenticates once the registration is no longer fresh', async () => {
    const { authenticator, provider } = setup()

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'heidi' } }],
    })
    requests.length = 0
    authenticator.calls.length = 0

    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now + 6 * 60 * 1_000)
    try {
      await provider.request({
        method: 'wallet_connect',
        params: [
          {
            capabilities: {
              authorizeAccessKey: { expiry: Expiry.days(1) },
              method: 'register',
              name: 'heidi',
            },
          },
        ],
      })
    } finally {
      vi.restoreAllMocks()
    }

    expect(paths()).toMatchInlineSnapshot(`
      [
        "/login/options",
        "/login",
      ]
    `)
  })

  test('behavior: re-authenticates with the server after disconnect', async () => {
    const { authenticator, provider } = setup()

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'carol' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })
    requests.length = 0
    authenticator.calls.length = 0

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { authorizeAccessKey: { expiry: Expiry.days(1) } } }],
    })

    expect(paths()).toMatchInlineSnapshot(`
      [
        "/login/options",
        "/login",
      ]
    `)
  })
})

describe('wallet_connect login with a stored credential', () => {
  test('behavior: prompts for the passkey while the server registers the challenge', async () => {
    const first = setup()
    const registered = await first.provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'erin' } }],
    })

    // A reload: a new provider over the same storage, with the account restored.
    const { authenticator, provider } = setup({
      authenticator: first.authenticator,
      storage: first.storage,
    })
    await Store.waitForHydration(provider.store)
    requests.length = 0
    authenticator.calls.length = 0

    const message = 'Sign in to localhost\nNonce: 5678'
    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login', personalSign: { message } } }],
    })

    expect(paths()).toMatchInlineSnapshot(`
      [
        "/login/options",
        "/login",
      ]
    `)
    expect(authenticator.calls.map((call) => call.method)).toMatchInlineSnapshot(`
      [
        "get",
      ]
    `)
    // The prompt opens before `/login/options` responds.
    const options = requests.find((request) => request.path.endsWith('/login/options'))!
    expect(authenticator.calls[0]!.time < options.end).toMatchInlineSnapshot(`true`)

    const account = result.accounts[0]!
    expect(account.address).toBe(registered.accounts[0]!.address)
    const valid = await verifyMessage(getClient(), {
      address: account.address,
      message,
      signature: account.capabilities.signature!,
    })
    expect(valid).toMatchInlineSnapshot(`true`)
  })
})
