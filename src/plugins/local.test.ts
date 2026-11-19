/**
 * Runs `local` with a memory store, or a file store in a temporary folder. No node listens: each test
 * reads what the owner signed from the session.
 * @module
 */
import * as Fs from 'node:fs/promises'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address, Secp256k1 } from 'ox'
import { KeyAuthorization, TxEnvelopeTempo } from 'ox/tempo'
import { custom } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { describe, expect, test } from 'vite-plus/test'
import * as Accounts from '../Accounts.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import {
  AccessKeyDisabledError,
  ExistsError,
  local,
  MissingError,
  SharedStoreError,
} from './local.js'
import { mpp } from '../mpp/index.js'
import { viem } from './viem.js'

/** Returns the address that signed the session's access key. */
function signer(session: Session.Any) {
  const authorization = KeyAuthorization.fromRpc(
    session.accessKey!.keyAuthorization,
  )
  return Address.checksum(
    Secp256k1.recoverAddress({
      payload: KeyAuthorization.getSignPayload(authorization),
      signature: (
        authorization.signature as {
          signature: Secp256k1.recoverAddress.Options['signature']
        }
      ).signature,
    }),
  )
}

function instance(
  options: local.Options & { store?: Store.Store | undefined } = {},
) {
  const { store = Store.memory(), ...rest } = options
  const accounts = Accounts.create({
    chain: 4217,
    clientId: 'cli:mercator',
    plugins: [local(rest), viem()],
    store,
    url: 'http://127.0.0.1:9',
  })
  return { accounts, store }
}

describe('local.create', () => {
  test('stores an owner key and signs in with an access key that it signed', async () => {
    const { accounts } = instance({ name: 'Mercator' })

    const session = await accounts.local.create()

    expect(session.kind).toBe('local')
    expect(Session.local(session)).toBe(true)
    expect(session.accessToken).toBeUndefined()
    expect(session.accessKey!.account).toBe(session.address)
    expect(session.accessKey!.chainId).toBe(4217)
    expect(session.accessKey!.privateKey).toBeDefined()
    expect(signer(session)).toBe(session.address)
    expect(await accounts.local.get()).toMatchObject({
      address: session.address,
      name: 'Mercator',
      type: 'secp256k1',
    })
    expect(await accounts.session.get()).toMatchObject({
      address: session.address,
      kind: 'local',
    })
    expect(accounts.viem.account.address).toBe(session.address)
  })

  test('throws ExistsError while the store holds an owner key, and keeps it', async () => {
    const { accounts } = instance()
    const { address } = await accounts.local.create()

    await expect(accounts.local.create()).rejects.toBeInstanceOf(ExistsError)
    expect((await accounts.local.get())!.address).toBe(address)
  })

  test('authorizes the access key with the given permissions', async () => {
    const { accounts } = instance()

    const session = await accounts.local.create({
      accessKey: {
        expiry: '1h',
        limits: [
          { limit: '10', token: '0x20c0000000000000000000000000000000000000' },
        ],
      },
    })
    const authorization = KeyAuthorization.fromRpc(
      session.accessKey!.keyAuthorization,
    )

    expect(authorization.limits).toHaveLength(1)
    expect(
      authorization.expiry! - Math.floor(Date.now() / 1000),
    ).toBeGreaterThan(3500)
    expect(
      authorization.expiry! - Math.floor(Date.now() / 1000),
    ).toBeLessThanOrEqual(3600)
  })
})

describe('local.signIn', () => {
  test('throws MissingError without an owner key', async () => {
    const { accounts } = instance()

    await expect(accounts.local.signIn()).rejects.toBeInstanceOf(MissingError)
  })

  test('keeps the live access key of the same owner', async () => {
    const { accounts } = instance()
    const created = await accounts.local.create()

    const session = await accounts.local.signIn()

    expect(session.accessKey!.keyAuthorization).toEqual(
      created.accessKey!.keyAuthorization,
    )
  })

  test('signs a new access key for new permissions', async () => {
    const { accounts } = instance()
    const created = await accounts.local.create()

    const session = await accounts.local.signIn({ accessKey: { expiry: '1h' } })

    expect(session.accessKey!.keyAuthorization).not.toEqual(
      created.accessKey!.keyAuthorization,
    )
    expect(signer(session)).toBe(created.address)
  })

  test('signs in on a new instance on the same store', async () => {
    const { accounts, store } = instance()
    const { address } = await accounts.local.create()
    await accounts.signOut()

    const next = instance({ store }).accounts
    const session = await next.local.signIn()

    expect(session.address).toBe(address)
    expect(signer(session)).toBe(address)
  })
})

describe('local.import', () => {
  test('signs in with the given private key', async () => {
    const { accounts } = instance()
    const privateKey = generatePrivateKey()

    const session = await accounts.local.import({ privateKey })

    expect(session.address).toBe(privateKeyToAccount(privateKey).address)
    expect(await accounts.local.export()).toBe(privateKey)
  })

  test('rejects a value that is no private key, and stores nothing', async () => {
    const { accounts } = instance()

    await expect(
      accounts.local.import({ privateKey: '0x1234' }),
    ).rejects.toThrow()
    expect(await accounts.local.get()).toBeUndefined()
  })
})

describe('local.remove', () => {
  test('signs out, and deletes the owner key', async () => {
    const { accounts } = instance()
    await accounts.local.create()

    await accounts.local.remove()

    expect(await accounts.session.get()).toBeUndefined()
    expect(await accounts.local.get()).toBeUndefined()
  })
})

describe('local', () => {
  test('refuses a shared store', async () => {
    const shared: Store.Store = {
      ...Store.memory(),
      json: true,
      private: false,
    }
    const { accounts } = instance({ store: shared })

    await expect(accounts.local.create()).rejects.toBeInstanceOf(
      SharedStoreError,
    )
  })

  test('throws LocalSessionError for the access token of a local session', async () => {
    const { accounts } = instance()
    await accounts.local.create()

    await expect(accounts.session.accessToken()).rejects.toBeInstanceOf(
      Accounts.LocalSessionError,
    )
  })

  test("sends the viem plugin's transaction with the access key, and the owner's authorization", async () => {
    const raw: `0x${string}`[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:mercator',
      plugins: [
        local(),
        viem({
          transport: custom({
            request({ method, params }) {
              // The keychain holds no key yet, so the transaction carries its authorization.
              if (method === 'eth_call')
                return Promise.resolve(`0x${'00'.repeat(160)}`)
              if (method === 'eth_sendRawTransactionSync') {
                raw.push((params as [`0x${string}`])[0])
                return Promise.reject(new Error('Not mined.'))
              }
              return Promise.resolve('0x1')
            },
          }),
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const session = await accounts.local.create()

    await accounts.viem.token
      .transferSync({
        amount: 1n,
        feeToken: '0x20c0000000000000000000000000000000000000',
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch(() => undefined)
    const transaction = TxEnvelopeTempo.deserialize(
      raw[0] as TxEnvelopeTempo.Serialized,
    )

    expect(raw).toHaveLength(1)
    // The access key signs for the owner's account, in a keychain envelope.
    expect(transaction.signature?.type).toBe('keychain')
    expect(
      Address.checksum(
        (transaction.signature as { userAddress: Address.Address }).userAddress,
      ),
    ).toBe(session.address)
    expect(
      Address.isEqual(
        transaction.keyAuthorization!.address,
        KeyAuthorization.fromRpc(session.accessKey!.keyAuthorization).address,
      ),
    ).toBe(true)
  })

  test('takes the active secp256k1 account of an accounts v0 file, and keeps the file', async () => {
    const folder = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-local-'))
    const path = Path.join(folder, 'wallet.json')
    const privateKey = generatePrivateKey()
    const other = generatePrivateKey()
    const v0 = {
      // An entry without a secp256k1 account comes first, and the scan passes over it.
      'other.store': { state: { accounts: [{ keyType: 'webAuthn' }] } },
      'mercator-local.store': {
        state: {
          accessKeys: [],
          accounts: [
            {
              address: privateKeyToAccount(other).address,
              keyType: 'secp256k1',
              privateKey: other,
            },
            {
              address: privateKeyToAccount(privateKey).address,
              keyType: 'secp256k1',
              privateKey,
            },
          ],
          activeAccount: 1,
          chainId: 4217,
        },
        version: 0,
      },
    }
    await Fs.writeFile(path, JSON.stringify(v0))
    const { accounts } = instance({
      store: Store.file(Path.join(folder, 'accounts.json')),
      v0: path,
    })

    const session = await accounts.local.signIn()

    expect(session.address).toBe(privateKeyToAccount(privateKey).address)
    expect(signer(session)).toBe(session.address)
    expect(JSON.parse(await Fs.readFile(path, 'utf8'))).toEqual(v0)
    await Fs.rm(folder, { force: true, recursive: true })
  })

  test('ignores a v0 file without a secp256k1 account', async () => {
    const folder = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-local-'))
    const path = Path.join(folder, 'wallet.json')
    await Fs.writeFile(
      path,
      JSON.stringify({
        'tempo-cli.store': { state: { accounts: [{ keyType: 'webAuthn' }] } },
      }),
    )
    const { accounts } = instance({ v0: path })

    expect(await accounts.local.get()).toBeUndefined()
    await Fs.rm(folder, { force: true, recursive: true })
  })
})

describe('review fixes', () => {
  test('creates one owner key for concurrent calls on one store', async () => {
    const store = Store.memory()
    const first = instance({ store }).accounts
    const second = instance({ store }).accounts

    const results = await Promise.allSettled([
      first.local.create(),
      second.local.create(),
      first.local.import({ privateKey: generatePrivateKey() }),
    ])
    const created = results.filter((result) => result.status === 'fulfilled')

    expect(created).toHaveLength(1)
    expect(
      results.filter(
        (result) =>
          result.status === 'rejected' && result.reason instanceof ExistsError,
      ),
    ).toHaveLength(2)
    expect((await first.local.get())!.address).toBe(
      (created[0] as PromiseFulfilledResult<Session.LocalSession>).value
        .address,
    )
  })

  test("authorizes on the chain that an earlier instance's switchChain saved", async () => {
    const store = Store.memory()
    const options = {
      chain: 4217,
      chains: [4217, 42431],
      clientId: 'cli:mercator',
      plugins: [local(), viem()],
      store,
      url: 'http://127.0.0.1:9',
    } as const
    const earlier = Accounts.create(options)
    await earlier.local.create()
    await earlier.switchChain({ chainId: 42431 })

    const session = await Accounts.create(options).local.signIn()

    expect(session.accessKey!.chainId).toBe(42431)
  })

  test('remove on a new instance signs out the saved session', async () => {
    const { accounts, store } = instance()
    await accounts.local.create()

    await instance({ store }).accounts.local.remove()

    expect(await instance({ store }).accounts.session.get()).toBeUndefined()
  })

  test('remove keeps the v0 file from giving the account again', async () => {
    const folder = await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-local-'))
    const path = Path.join(folder, 'wallet.json')
    const privateKey = generatePrivateKey()
    await Fs.writeFile(
      path,
      JSON.stringify({
        'tempo-cli.store': {
          state: { accounts: [{ keyType: 'secp256k1', privateKey }] },
        },
      }),
    )
    const { accounts } = instance({ v0: path })
    expect((await accounts.local.get())!.address).toBe(
      privateKeyToAccount(privateKey).address,
    )

    await accounts.local.remove()
    expect(await accounts.local.get()).toBeUndefined()
    const other = generatePrivateKey()
    const session = await accounts.local.import({ privateKey: other })

    expect(session.address).toBe(privateKeyToAccount(other).address)
    await Fs.rm(folder, { force: true, recursive: true })
  })

  test('throws AccessKeyDisabledError for an instance with accessKey: false, and stores no key', async () => {
    const accounts = Accounts.create({
      accessKey: false,
      chain: 4217,
      clientId: 'cli:mercator',
      plugins: [local(), viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })

    await expect(accounts.local.create()).rejects.toBeInstanceOf(
      AccessKeyDisabledError,
    )
    expect(await accounts.local.get()).toBeUndefined()
    await expect(
      accounts.local.create({ accessKey: { expiry: '1h' } }),
    ).resolves.toMatchObject({ kind: 'local' })
  })
})

describe('local with mpp', () => {
  test('sends a request to an origin of `identity.scope` without an identity', async () => {
    const requests: Request[] = []
    const accounts = Accounts.create({
      chain: 4217,
      clientId: 'cli:mercator',
      plugins: [
        local(),
        viem(),
        mpp({
          fetch: (input, init) => {
            requests.push(new Request(input, init))
            return Promise.resolve(new Response('free'))
          },
          identity: { scope: ['https://api.example.com'] },
        }),
      ],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    await accounts.local.create()

    const response = await accounts
      .mpp()
      .fetch('https://api.example.com/fortune')

    expect(await response.text()).toBe('free')
    expect(
      requests.map((request) => request.headers.get('authorization')),
    ).toEqual([null])
  })
})

describe('local with Tempo ID calls', () => {
  test('switchChain moves a local session to a chain without an access key, and signIn signs one there', async () => {
    const accounts = Accounts.create({
      chain: 4217,
      chains: [4217, 42431],
      clientId: 'cli:mercator',
      plugins: [local(), viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    const { address } = await accounts.local.create()

    await accounts.switchChain({ chainId: 42431 })
    const session = await accounts.local.signIn()

    expect(accounts.chain.get()).toBe(42431)
    expect(session.address).toBe(address)
    expect(session.accessKey!.chainId).toBe(42431)
    expect(
      session.accessKeys!.map((entry) => entry.chainId).sort((a, b) => a - b),
    ).toEqual([4217, 42431])
  })

  test('account.get throws LocalSessionError, and sends no request', async () => {
    const { accounts } = instance()
    await accounts.local.create()

    await expect(accounts.account.get()).rejects.toBeInstanceOf(
      Accounts.LocalSessionError,
    )
  })

  test("a viem transaction without the chain's access key rejects, and opens no Tempo ID sign-in", async () => {
    const accounts = Accounts.create({
      chain: 4217,
      chains: [4217, 42431],
      clientId: 'cli:mercator',
      plugins: [local(), viem()],
      store: Store.memory(),
      url: 'http://127.0.0.1:9',
    })
    await accounts.local.create()
    await accounts.switchChain({ chainId: 42431 })

    const error = await accounts.viem.token
      .transferSync({
        amount: 1n,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: Error) => error)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).name).not.toBe('Accounts.RetryAccountError')
    expect(await accounts.session.get()).toMatchObject({ kind: 'local' })
  })
})
