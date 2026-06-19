import { Address, Hex, Json, PublicKey } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { parseUnits, type Address as viem_Address } from 'viem'
import { Actions, Addresses } from 'viem/tempo'
import { afterEach, describe, expect, test, vi } from 'vp/test'
import { Wata as HostWata, postMessage as hostPostMessage } from 'wata/host'
import * as z from 'zod/mini'

import { accounts, chain, getClient } from '../../../../test/config.js'
import * as Keystore from '../../Keystore.js'
import * as Provider from '../../Provider.js'
import * as Storage from '../../Storage.js'
import * as Store from '../../Store.js'
import * as Rpc from '../../zod/rpc.js'
import { postMessage } from './postMessage.js'
import { tempoWallet } from './tempoWallet.js'

const root = accounts[0]!
const transferCall = Actions.token.transfer.call({
  to: '0x0000000000000000000000000000000000000001',
  token: Addresses.pathUsd,
  amount: parseUnits('1', 6),
})

const hosts: Promise<Pick<Awaited<ReturnType<typeof createHost>>, 'close' | 'notify'>>[] = []

afterEach(async () => {
  vi.unstubAllGlobals()
  await Promise.all(hosts.splice(0).map((host) => host.then((session) => session.close())))
})

async function fund(address: viem_Address) {
  await Actions.token.transferSync(getClient(), {
    account: root,
    feeToken: Addresses.pathUsd,
    to: address,
    token: Addresses.pathUsd,
    amount: parseUnits('10', 6),
  })
}

function asyncJsonStorage(options: Storage.from.Options = {}) {
  const store = new Map<string, string>()
  return Storage.from(
    {
      async getItem(name) {
        const raw = store.get(name)
        if (!raw) return null
        return Json.parse(raw)
      },
      async setItem(name, value) {
        store.set(name, Json.stringify(value))
      },
      async removeItem(name) {
        store.delete(name)
      },
    },
    options,
  )
}

/**
 * In-process wallet endpoint. `target` is called whenever the adapter
 * (re-)opens its session: it mints a fresh `MessageChannel` and parks a wata
 * host on the far port — the port-pair stand-in for the wallet window. The
 * `opened` log therefore counts session mounts, not requests.
 */
function createWallet() {
  const opened: string[] = []
  const requests: { method: string; params: unknown }[] = []

  return {
    opened: () => opened,
    requests: () => requests,
    target: ({ host }: { host: string | undefined }) => {
      opened.push(host ?? '')
      const channel = new MessageChannel()
      hosts.push(createHost(requests, channel.port2))
      return channel.port1
    },
  }
}

async function createHost(requests: { method: string; params: unknown }[], port: MessagePort) {
  const host = HostWata.create({
    transports: [hostPostMessage({ target: () => port })],
  })

  const session = await host.start()

  session.onRequest(async (event) => {
    requests.push({ method: event.method, params: event.params })
    if (event.method === 'wallet_connect') {
      const [parameters] = z.decode(Rpc.wallet_connect.schema.params!, event.params as never) ?? []
      const capabilities = parameters?.capabilities
      const authorization = capabilities?.authorizeAccessKey
      await event.respond({
        accounts: [
          {
            address: root.address,
            capabilities: {
              ...(authorization
                ? {
                    keyAuthorization: KeyAuthorization.toRpc(
                      await signKeyAuthorization(authorization),
                    ),
                  }
                : {}),
              ...(capabilities?.personalSign ? { personalSign: capabilities.personalSign } : {}),
              ...(await signature(capabilities)),
            },
          },
        ],
      })
      return
    }
    if (event.method === 'wallet_authorizeAccessKey') {
      const [parameters] = z.decode(
        Rpc.wallet_authorizeAccessKey.schema.params!,
        event.params as never,
      )
      await event.respond({
        keyAuthorization: KeyAuthorization.toRpc(await signKeyAuthorization(parameters)),
        rootAddress: root.address,
      })
      return
    }
    if (event.method === 'personal_sign') {
      const [data] = z.decode(Rpc.personal_sign.schema.params!, event.params as never)
      await event.respond(await root.signMessage({ message: { raw: data } }))
      return
    }
    if (event.method === 'wallet_deposit') {
      await event.respond({ receipts: [] })
      return
    }
    if (event.method === 'wallet_revokeAccessKey') {
      await event.respond(null)
    }
  })

  return session
}

async function signKeyAuthorization(parameters: AdapterAuthorizeParameters) {
  return await root.signKeyAuthorization(
    {
      accessKeyAddress: accessKeyAddress(parameters),
      keyType: parameters.keyType ?? 'p256',
    },
    {
      chainId: parameters.chainId ?? BigInt(chain.id),
      expiry: parameters.expiry,
      ...(parameters.limits ? { limits: parameters.limits } : {}),
    },
  )
}

function accessKeyAddress(parameters: AdapterAuthorizeParameters) {
  if (parameters.address) return parameters.address
  if (!parameters.publicKey)
    throw new Error('Expected access key address or public key in wallet request.')
  return Address.fromPublicKey(PublicKey.fromHex(parameters.publicKey))
}

function connectParameters(wallet: ReturnType<typeof createWallet>, index: number) {
  const [parameters] =
    z.decode(Rpc.wallet_connect.schema.params!, wallet.requests()[index]!.params as never) ?? []
  return parameters
}

async function signature(
  capabilities:
    | NonNullable<NonNullable<Rpc.wallet_connect.Decoded['params']>[number]['capabilities']>
    | undefined,
) {
  if (capabilities?.digest) return { signature: await root.sign({ hash: capabilities.digest }) }
  if (capabilities?.personalSign)
    return { signature: await root.signMessage({ message: capabilities.personalSign.message }) }
  return {}
}

function personalSignParameters(wallet: ReturnType<typeof createWallet>, index: number) {
  const [data, address] = z.decode(
    Rpc.personal_sign.schema.params!,
    wallet.requests()[index]!.params as never,
  )
  return { address, data }
}

type AdapterAuthorizeParameters = NonNullable<
  Rpc.wallet_authorizeAccessKey.Decoded['params']
>[number]

function createProvider(
  wallet: ReturnType<typeof createWallet>,
  options: Omit<Provider.create.Options, 'adapter' | 'chains'> &
    Partial<Pick<postMessage.Options, 'host' | 'name' | 'rdns'>> = {},
) {
  const {
    host = 'https://wallet.tempo.xyz/post-message',
    name = 'Accounts Web Test',
    rdns = 'xyz.tempo.accounts.playground',
    ...rest
  } = options
  return Provider.create({
    chains: [chain],
    ...rest,
    adapter: postMessage({
      host,
      name,
      rdns,
      target: wallet.target,
    }),
  })
}

describe('create', () => {
  test('behavior: tempoWallet defaults host to the Tempo Wallet post-message page', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: tempoWallet({ target: wallet.target }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/post-message",
      ]
    `)
    expect(wallet.requests()[0]?.method).toBe('wallet_connect')
  })

  test('behavior: tempoWallet bakes theme onto the wallet page URL', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: tempoWallet({
        target: wallet.target,
        theme: { accent: 'blue', radius: 'medium', scheme: 'dark' },
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/post-message?accent=blue&radius=medium&scheme=dark",
      ]
    `)
  })

  test('behavior: accepts explicit postMessage adapter', async () => {
    const wallet = createWallet()
    const provider = Provider.create({
      adapter: postMessage({
        host: 'https://wallet.example/post-message',
        name: 'Custom Wallet',
        rdns: 'xyz.tempo.custom',
        target: wallet.target,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.example/post-message",
      ]
    `)
  })

  test('behavior: tags the wallet page URL with the app origin', async () => {
    vi.stubGlobal('window', {
      addEventListener() {},
      dispatchEvent: () => true,
      location: { origin: 'https://app.example' },
      removeEventListener() {},
    })

    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(wallet.opened()).toMatchInlineSnapshot(`
      [
        "https://wallet.tempo.xyz/post-message?origin=https%3A%2F%2Fapp.example",
      ]
    `)
  })

  test('behavior: persists managed access keys through provider storage', async () => {
    const storage = asyncJsonStorage({ key: 'post-message-managed-key' })
    // String-based storage can't persist the non-extractable WebCrypto
    // default, so an extractable keystore is required for the managed key to
    // survive a reload here (structured-clone storage would persist either).
    const accessKey = { keystores: { p256: Keystore.webCryptoP256({ extractable: true }) } }
    const wallet = createWallet()
    const provider1 = createProvider(wallet, {
      accessKey,
      authorizeAccessKey: () => ({
        expiry: Math.floor(Date.now() / 1000) + 3600,
      }),
      storage,
    })

    const result = await provider1.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'register', name: 'Accounts Web Test' } }],
    })
    expect(result.accounts[0]!.address).toBe(root.address)
    expect(
      connectParameters(wallet, 0)?.capabilities?.authorizeAccessKey?.keyType,
    ).toMatchInlineSnapshot(`"p256"`)

    await fund(root.address)

    const provider2 = createProvider(wallet, {
      accessKey,
      storage,
    })
    await Store.waitForHydration(provider2.store)

    const receipt = await provider2.request({
      method: 'eth_sendTransactionSync',
      params: [{ calls: [transferCall], feeToken: Addresses.pathUsd }],
    })
    expect(receipt.status).toBe('0x1')
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: reuses one wallet page session for sequential requests', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await provider.request({
      method: 'personal_sign',
      params: [Hex.fromString('hello'), root.address],
    })
    await provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })

    expect(wallet.requests().map((request) => request.method)).toMatchInlineSnapshot(`
      [
        "wallet_connect",
        "personal_sign",
        "wallet_deposit",
      ]
    `)
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: reuses the wallet page session across disconnect', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    expect(provider.store.getState().accounts).toHaveLength(1)

    // `wallet_disconnect` is a local teardown (logout + clear); it never
    // reaches the wallet. The wallet-page session is a persistent channel, so
    // reconnecting reuses the already-handshaked session rather than reopening
    // a new one — the second login must still round-trip and succeed.
    await provider.request({ method: 'wallet_disconnect' })
    expect(provider.store.getState().accounts).toHaveLength(0)

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(wallet.opened()).toHaveLength(1)
    expect(wallet.requests().filter((request) => request.method === 'wallet_connect')).toHaveLength(
      2,
    )
  })

  test('behavior: serializes overlapping requests over one session', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    const [result, deposit] = await Promise.all([
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
      provider.request({ method: 'wallet_deposit', params: [{ amount: '25', token: 'USDC' }] }),
    ])

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(deposit).toMatchInlineSnapshot(`
      {
        "receipts": [],
      }
    `)
    expect(wallet.opened()).toHaveLength(1)
    // Arrival order at the adapter is not defined for overlapping calls —
    // only that both round-trip through the single session.
    expect(
      wallet
        .requests()
        .map((request) => request.method)
        .sort(),
    ).toMatchInlineSnapshot(`
      [
        "wallet_connect",
        "wallet_deposit",
      ]
    `)
  })

  test('behavior: forwards personal_sign through the wallet page', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    const data = Hex.fromString('hello')
    const signature = await provider.request({
      method: 'personal_sign',
      params: [data, root.address],
    })
    const forwarded = personalSignParameters(wallet, 1)

    expect(forwarded.address).toBe(root.address)
    expect(forwarded.data).toBe(data)
    expect(signature).toMatch(/^0x[0-9a-f]+$/)
  })

  test('behavior: forwards wallet_deposit through the wallet page', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })

    expect(wallet.requests()[0]).toMatchInlineSnapshot(`
      {
        "method": "wallet_deposit",
        "params": [
          {
            "amount": "25",
            "token": "USDC",
          },
        ],
      }
    `)
    expect(result).toMatchInlineSnapshot(`
      {
        "receipts": [],
      }
    `)
  })

  test('behavior: disconnects locally without opening the wallet page', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    expect(provider.store.getState().accounts).toHaveLength(1)

    await provider.request({ method: 'wallet_disconnect' })

    expect(provider.store.getState().accounts).toHaveLength(0)
    expect(wallet.opened()).toHaveLength(1)
  })

  test('behavior: reconciles disconnect when the wallet asserts no accounts', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    expect(provider.store.getState().accounts).toHaveLength(1)

    // The wallet reports the user is no longer connected (logout / revoke);
    // the SDK drops the stale persisted session.
    await (await hosts[0]!).notify({ method: 'accountsChanged', params: [] })

    await vi.waitFor(() => expect(provider.store.getState().accounts).toHaveLength(0))
  })

  test('behavior: keeps the session when the wallet still asserts the account', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, { storage: Storage.memory() })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    await (await hosts[0]!).notify({ method: 'accountsChanged', params: [root.address] })
    // The assertion still lists the account, so nothing is dropped.
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(provider.store.getState().accounts).toHaveLength(1)
  })

  test('behavior: switches chains locally without opening the wallet page', async () => {
    const wallet = createWallet()
    const provider = createProvider(wallet, {
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: Hex.fromNumber(chain.id) }],
    })

    expect(await provider.request({ method: 'eth_chainId' })).toBe(Hex.fromNumber(chain.id))
    expect(wallet.opened()).toHaveLength(0)
  })

  test('behavior: rejects when the wallet page closes without answering', async () => {
    // Window targets receive inbound frames through the global `window`;
    // stub one so the transport can attach its listener, and hand back a
    // popup stand-in that reports itself closed.
    vi.stubGlobal('window', {
      addEventListener() {},
      dispatchEvent: () => true,
      location: { origin: 'https://app.example' },
      removeEventListener() {},
    })

    const provider = Provider.create({
      adapter: postMessage({
        host: 'https://wallet.example/post-message',
        name: 'Custom Wallet',
        rdns: 'xyz.tempo.custom',
        target: () =>
          ({
            addEventListener() {},
            closed: true,
            postMessage() {},
            removeEventListener() {},
          }) as unknown as Window,
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await expect(
      provider.request({
        method: 'wallet_connect',
        params: [{ capabilities: { method: 'login' } }],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      '[Provider.UserRejectedRequestError: The user rejected the request.]',
    )
  })
})

describe('mount', () => {
  const consumerOrigin = 'https://app.example'
  const walletOrigin = 'https://wallet.tempo.xyz'

  type RealmListener = (event: { data: unknown; origin: string }) => void

  function realm() {
    const listeners = new Set<RealmListener>()
    return {
      addEventListener: (_type: string, listener: RealmListener) => void listeners.add(listener),
      deliver(data: unknown, origin: string) {
        for (const listener of [...listeners]) listener({ data, origin })
      },
      removeEventListener: (_type: string, listener: RealmListener) =>
        void listeners.delete(listener),
    }
  }

  /**
   * Fakes the browser side of a mount: a consumer realm installed as the
   * global `window` (with `window.open` minting a fresh in-process wallet
   * window per call) and a `document` stub for `Mount.popup()`'s overlay.
   */
  function installBrowser(wire = wireWallet) {
    const consumerRealm = realm()
    const opened: string[] = []
    const opened_handles: ReturnType<typeof walletWindow>['handle'][] = []
    const window_ = Object.assign(consumerRealm, {
      dispatchEvent: () => true,
      innerWidth: 1024,
      location: { origin: consumerOrigin },
      open: (url: string) => {
        opened.push(url)
        const window_wallet = walletWindow(consumerRealm, wire)
        opened_handles.push(window_wallet.handle)
        return window_wallet.handle
      },
      screenX: 0,
      screenY: 0,
    })
    vi.stubGlobal('window', window_)
    vi.stubGlobal('document', fakeDocument())
    return { consumerRealm, opened, opened_handles }
  }

  /** Minimal DOM for `Mount.popup()`'s overlay. */
  function fakeDocument() {
    const element = () => ({
      addEventListener() {},
      appendChild() {},
      remove() {},
      style: {},
      textContent: '',
    })
    return { body: element(), createElement: () => element() }
  }

  /**
   * In-process wallet window: a wata host on its own realm, wired so frames
   * cross between realms stamped with the sender's origin.
   */
  function walletWindow(consumerRealm: ReturnType<typeof realm>, wire = wireWallet) {
    const walletRealm = realm()
    let wired = false
    const buffered: unknown[] = []
    const handle = {
      addEventListener() {},
      closed: false,
      close() {
        this.closed = true
      },
      focus() {},
      postMessage: (data: unknown) => walletRealm.deliver(data, consumerOrigin),
    }
    const opener = {
      addEventListener() {},
      postMessage: (data: unknown) => {
        if (wired) consumerRealm.deliver(data, walletOrigin)
        else buffered.push(data)
      },
    }
    const session = createWalletHost(walletRealm, opener).start()
    wire(session)
    wired = true
    for (const data of buffered.splice(0)) consumerRealm.deliver(data, walletOrigin)
    const host = Promise.resolve(session)
    hosts.push(host)
    return { handle, host }
  }

  function createWalletHost(
    walletRealm: ReturnType<typeof realm>,
    opener: { addEventListener: () => void; postMessage: (data: unknown) => void },
  ) {
    return HostWata.create({
      transports: [
        hostPostMessage({
          source: walletRealm as never,
          target: () => opener as unknown as Window,
          targetOrigin: consumerOrigin,
        }),
      ],
    })
  }

  type WalletSession = Awaited<ReturnType<ReturnType<typeof createWalletHost>['start']>>

  /** Answers wallet RPC like the live endpoint, plus dialog notifications. */
  function wireWallet(session: WalletSession) {
    const live: { reject: (error: { code: number; message: string }) => Promise<void> }[] = []
    session.onRequest(async (event) => {
      live.push(event)
      if (event.method === 'wallet_connect') {
        await event.respond({ accounts: [{ address: root.address, capabilities: {} }] })
        return
      }
      if (event.method === 'personal_sign') {
        const [data] = z.decode(Rpc.personal_sign.schema.params!, event.params as never)
        await event.respond(await root.signMessage({ message: { raw: data } }))
      }
      // Other methods stay pending (e.g. awaiting a cancel).
    })
    session.onNotification((event) => {
      if (event.method !== 'cancel') return
      for (const pending of live.splice(0))
        void pending.reject({ code: 4001, message: 'User rejected the request.' }).catch(() => {})
    })
  }

  function scriptedMount(
    events: string[],
    consumerRealm: ReturnType<typeof realm>,
    wire = wireWallet,
  ) {
    let dismiss: (() => void) | undefined
    const factory = Object.assign(
      (parameters: { host: string; onDismiss: () => void }) => {
        dismiss = parameters.onDismiss
        events.push(`mount:${parameters.host}`)
        const window_wallet = walletWindow(consumerRealm, wire)
        return {
          close: () => void events.push('close'),
          destroy: () => void events.push('destroy'),
          hide: () => void events.push('hide'),
          mode: 'iframe' as const,
          show: () => void events.push('show'),
          target: () => {
            events.push('target')
            return window_wallet.handle as unknown as Window
          },
        }
      },
      { mode: 'iframe' as const },
    )
    return { dismiss: () => dismiss?.(), factory }
  }

  test('behavior: mounts eagerly and surfaces only while requests are pending', async () => {
    const { consumerRealm } = installBrowser()
    const events: string[] = []
    const scripted = scriptedMount(events, consumerRealm)

    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: scripted.factory,
        name: 'Accounts Web Test',
        rdns: 'xyz.tempo.accounts.playground',
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    expect(events[0]).toMatchInlineSnapshot(
      `"mount:https://wallet.tempo.xyz/post-message?origin=https%3A%2F%2Fapp.example&mode=iframe"`,
    )
    expect(events).not.toContain('target')
    expect(events).not.toContain('show')

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    expect(events.filter((event) => event === 'show')).toHaveLength(1)
    await vi.waitFor(() => expect(events.at(-1)).toBe('hide'))

    await provider.request({
      method: 'personal_sign',
      params: [Hex.fromString('hello'), root.address],
    })
    expect(events.filter((event) => event === 'show')).toHaveLength(2)
    await vi.waitFor(() => expect(events.at(-1)).toBe('hide'))
    // One mount, one session for the provider's lifetime.
    expect(events.filter((event) => event.startsWith('mount:'))).toHaveLength(1)
    expect(events.filter((event) => event === 'target')).toHaveLength(1)
  })

  test('behavior: keeps the iframe mount up across disconnect', async () => {
    const { consumerRealm } = installBrowser()
    const events: string[] = []
    const scripted = scriptedMount(events, consumerRealm)

    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: scripted.factory,
        name: 'Accounts Web Test',
        rdns: 'xyz.tempo.accounts.playground',
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    await provider.request({ method: 'wallet_disconnect' })

    // Disconnect is a local teardown — the mount and its handshaked session
    // stay up, so the iframe is never destroyed and the next login reuses the
    // same session instead of stranding on a stale handshake.
    expect(events).not.toContain('destroy')

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts[0]!.address).toBe(root.address)
    expect(events.filter((event) => event.startsWith('mount:'))).toHaveLength(1)
    expect(events.filter((event) => event === 'target')).toHaveLength(1)
  })

  test('behavior: cleanup closes in-flight Safari popup fallback', async () => {
    const { consumerRealm, opened_handles } = installBrowser((session) => session.onRequest(() => {}))
    vi.stubGlobal('navigator', { userAgent: 'Version/17.0 Safari/605.1.15' })
    const events: string[] = []
    const scripted = scriptedMount(events, consumerRealm)
    const storage = Storage.memory()
    const store = Store.create({ chainId: chain.id, storage })
    const adapter = postMessage({
      host: `${walletOrigin}/post-message`,
      mount: scripted.factory,
      name: 'Accounts Web Test',
      rdns: 'xyz.tempo.accounts.playground',
    })({
      getAccount: () => ({ address: root.address, type: 'json-rpc' }) as never,
      getClient: () => ({}) as never,
      storage,
      store,
    })

    const pending = adapter.actions.loadAccounts(undefined, {
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })
    void pending.catch(() => {})

    await vi.waitFor(() => expect(opened_handles).toHaveLength(1))
    expect(opened_handles[0]!.closed).toBe(false)

    adapter.cleanup?.()

    await vi.waitFor(() => expect(opened_handles[0]!.closed).toBe(true))
    await expect(pending).rejects.toMatchObject({ code: 4001 })
  })

  test('behavior: dismissing the mount cancels the in-flight request', async () => {
    const { consumerRealm } = installBrowser()
    const events: string[] = []
    const scripted = scriptedMount(events, consumerRealm)

    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: scripted.factory,
        name: 'Accounts Web Test',
        rdns: 'xyz.tempo.accounts.playground',
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    // wallet_deposit stays pending wallet-side until cancelled.
    const denied = provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })
    await vi.waitFor(() => expect(events).toContain('show'))
    await vi.waitFor(() => expect(events).toContain('target'))

    scripted.dismiss()
    await expect(denied).rejects.toMatchObject({ code: 4001 })
    await vi.waitFor(() => expect(events.at(-1)).toBe('hide'))
  })

  test('behavior: dismissing rejects locally even when the wallet ignores the cancel', async () => {
    const { consumerRealm } = installBrowser()
    const events: string[] = []
    // Wallet accepts the request but never answers and ignores notifications
    // (a wedged iframe). Dismiss must still reject — there is no closed poll.
    const scripted = scriptedMount(events, consumerRealm, (session) => session.onRequest(() => {}))

    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: scripted.factory,
        name: 'Accounts Web Test',
        rdns: 'xyz.tempo.accounts.playground',
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    const denied = provider.request({
      method: 'wallet_deposit',
      params: [{ amount: '25', token: 'USDC' }],
    })
    await vi.waitFor(() => expect(events).toContain('show'))

    scripted.dismiss()
    await expect(denied).rejects.toMatchObject({ code: 4001 })
    await vi.waitFor(() => expect(events.at(-1)).toBe('hide'))
  })

  test('behavior: switch notification remounts in a popup and replays the request', async () => {
    const { consumerRealm, opened } = installBrowser()
    const events: string[] = []
    // The iframe wallet asks to continue in a popup instead of answering.
    const scripted = scriptedMount(events, consumerRealm, (session) =>
      session.onRequest(() => void session.notify({ method: 'switch-mode', params: [] })),
    )

    const provider = Provider.create({
      adapter: postMessage({
        host: `${walletOrigin}/post-message`,
        mount: scripted.factory,
        name: 'Accounts Web Test',
        rdns: 'xyz.tempo.accounts.playground',
      }),
      chains: [chain],
      storage: Storage.memory(),
    })

    const result = await provider.request({
      method: 'wallet_connect',
      params: [{ capabilities: { method: 'login' } }],
    })

    expect(result.accounts[0]!.address).toBe(root.address)
    // The iframe mount was destroyed and the popup (window.open) answered.
    expect(events).toContain('destroy')
    expect(opened).toHaveLength(1)
    expect(opened[0]).toContain('mode=popup')
  })
})
