/**
 * Tests of the wagmi connector's chain, the access token of the wagmi plugin's account read, and
 * of the connector's machine of `disconnect` calls.
 * @module
 */
import {
  connect,
  createConfig,
  getChainId,
  getConnection,
  getWalletClient,
  http,
  reconnect,
  sendCalls,
  signMessage,
  signTypedData,
} from '@wagmi/core'
import * as Fs from 'node:fs/promises'
import * as Http from 'node:http'
import type * as Net from 'node:net'
import * as Os from 'node:os'
import * as Path from 'node:path'
import { Address, Base64, Secp256k1 } from 'ox'
import { KeyAuthorization } from 'ox/tempo'
import { custom, MethodNotSupportedRpcError } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { sendTransaction, signTransaction } from 'viem/actions'
import { Actions } from 'viem/tempo'
import { tempo, tempoDevnet, tempoModerato } from 'viem/tempo/chains'
import { describe, expect, test } from 'vite-plus/test'
import { createActor, getNextSnapshot, initialTransition } from 'xstate'
import { getShortestPaths } from 'xstate/graph'
import * as Accounts from '../Accounts.js'
import { device } from '../plugins/device.js'
import { dialog } from '../plugins/dialog.js'
import { email } from '../plugins/email.js'
import * as Dpop from '../internal/Dpop.js'
import * as InternalSession from '../internal/Session.js'
import * as Plugin from '../Plugin.js'
import * as Session from '../Session.js'
import * as Store from '../Store.js'
import { machines, tempoId, wagmi } from './index.js'

describe('tempoId', () => {
  const chains = [tempo, tempoModerato, tempoDevnet] as const
  const transports = {
    [tempo.id]: http(),
    [tempoDevnet.id]: http(),
    [tempoModerato.id]: http(),
  }

  test("uses the config's first chain without `chainId`", async () => {
    const config = createConfig({
      chains,
      connectors: [tempoId({ clientId: 'client_test' })],
      transports,
    })
    const connector = config.connectors[0]!

    const chainId = await connector.getChainId()
    const instance = await connector.getInstance()

    expect(chainId).toMatchInlineSnapshot(`4217`)
    expect(instance.config.chainId).toMatchInlineSnapshot(`4217`)
  })

  test('switchChain selects another chain of the config, and refuses one outside it', async () => {
    const config = createConfig({
      chains,
      connectors: [tempoId({ clientId: 'client_test' })],
      transports,
    })
    const connector = config.connectors[0]!
    const changes: unknown[] = []
    connector.emitter.on('change', (data) => changes.push(data))

    const provider = await connector.getProvider()
    const before = await provider.request({ method: 'eth_chainId' })
    const switched = await connector.switchChain!({ chainId: tempoDevnet.id })
    const after = await provider.request({ method: 'eth_chainId' })
    const chainId = await connector.getChainId()
    const client = await connector.getClient!()
    const refused = await connector.switchChain!({ chainId: 1 }).catch(
      (error: Error) => error,
    )

    expect(before).toMatchInlineSnapshot(`"0x1079"`)
    expect(after).toMatchInlineSnapshot(`"0x7a56"`)
    expect(switched.id).toMatchInlineSnapshot(`31318`)
    expect(chainId).toMatchInlineSnapshot(`31318`)
    expect(client.chain?.id).toMatchInlineSnapshot(`31318`)
    expect(changes.map((entry) => (entry as { chainId: number }).chainId))
      .toMatchInlineSnapshot(`
      [
        31318,
      ]
    `)
    expect(refused).toMatchInlineSnapshot(
      `[wagmi.ChainNotConfiguredError: Invalid chain: 1 is not a chain of the config. Add the chain to the config's \`chains\`, or set \`chainId\` to one of them.]`,
    )
  })

  test('uses the chain of `chainId`, also when it is not first', async () => {
    const config = createConfig({
      chains,
      connectors: [
        tempoId({ chainId: tempoDevnet.id, clientId: 'client_test' }),
      ],
      transports,
    })
    const connector = config.connectors[0]!

    const chainId = await connector.getChainId()
    const instance = await connector.getInstance()
    const configured = instance.config.chainId
    const client = await connector.getClient!()

    expect(chainId).toMatchInlineSnapshot(`31318`)
    expect(configured).toMatchInlineSnapshot(`31318`)
    expect(client.chain?.id).toMatchInlineSnapshot(`31318`)
  })

  test('keeps the chain of a later `connect` or switch after an earlier `connect` with `chainId` fails, the first chain after overlapping failures, also of calls that start together on repeated chains, a switch of the instance, also a queued one, and the chain of a redirect that left the page', async () => {
    const create = () =>
      createConfig({
        chains: [tempo, tempoModerato, tempoDevnet],
        connectors: [
          tempoId({
            clientId: 'https://app.example.com',
            plugins: [email()],
            store: Store.memory(),
            url: 'http://127.0.0.1:9',
          }),
        ],
        transports: {
          [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
          [tempoDevnet.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
          [tempoModerato.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
        },
      })
    /** Starts a `connect` with `chainId` whose sign-in rejects at `close`. */
    function pending(
      connector: ReturnType<typeof create>['connectors'][0],
      chainId: number = tempoModerato.id,
    ) {
      const closed = Promise.withResolvers<void>()
      const call = connector
        .connect({
          chainId,
          signIn: () =>
            closed.promise.then(() => {
              throw new DOMException(
                'The user closed the sign-in.',
                'AbortError',
              )
            }),
        } as never)
        .catch(() => undefined)
      return { call, close: closed.resolve }
    }
    const later = create().connectors[0]!
    const overlapping = create().connectors[0]!
    const switched = create().connectors[0]!

    // A later `connect` without `chainId` signs in on the chain of the earlier one.
    const first = pending(later)
    await expect.poll(() => later.getChainId()).toBe(tempoModerato.id)
    const second = later
      .connect({ signIn: () => new Promise(() => undefined) } as never)
      .catch(() => undefined)
    first.close()
    await first.call
    // Two overlapping calls on other chains fail.
    const a = pending(overlapping)
    await expect.poll(() => overlapping.getChainId()).toBe(tempoModerato.id)
    const b = pending(overlapping, tempoDevnet.id)
    await expect.poll(() => overlapping.getChainId()).toBe(tempoDevnet.id)
    a.close()
    b.close()
    await Promise.all([a.call, b.call])
    // Two calls that start together, before either switch applies, fail.
    const together = create().connectors[0]!
    const c = pending(together)
    const d = pending(together, tempoDevnet.id)
    await expect.poll(() => together.getChainId()).toBe(tempoDevnet.id)
    c.close()
    d.close()
    await Promise.all([c.call, d.call])
    // Three calls that start together, two of them on the same chain, fail.
    const repeated = create().connectors[0]!
    const calls = [
      pending(repeated),
      pending(repeated),
      pending(repeated, tempoDevnet.id),
    ]
    await expect.poll(() => repeated.getChainId()).toBe(tempoDevnet.id)
    for (const entry of calls) entry.close()
    await Promise.all(calls.map((entry) => entry.call))
    // The app selects the chain of an earlier call on the instance, after both switches apply.
    const selected = create().connectors[0]!
    const g = pending(selected)
    const h = pending(selected, tempoDevnet.id)
    await expect.poll(() => selected.getChainId()).toBe(tempoDevnet.id)
    const instance = await selected.getInstance()
    await instance.switchChain({ chainId: tempoModerato.id })
    g.close()
    h.close()
    await Promise.all([g.call, h.call])
    // The app starts a switch of the instance, which is still queued when the sign-in fails.
    const direct = create().connectors[0]!
    const k = pending(direct)
    await expect.poll(() => direct.getChainId()).toBe(tempoModerato.id)
    const switching = (await direct.getInstance()).switchChain({
      chainId: tempoDevnet.id,
    })
    k.close()
    await Promise.all([k.call, switching])
    // A sign-in that leaves the page for a redirect returns without a session.
    const redirected = create().connectors[0]!
    const left = await redirected
      .connect({
        chainId: tempoModerato.id,
        signIn: () => Promise.resolve(),
      } as never)
      .catch((error: Error) => error.name)
    // A switch that the connector queues before the failure settles after it.
    const third = pending(switched)
    await expect.poll(() => switched.getChainId()).toBe(tempoModerato.id)
    const queued = switched.switchChain!({ chainId: tempoDevnet.id })
    third.close()
    await third.call
    await queued

    expect({
      later: await later.getChainId(),
      direct: await direct.getChainId(),
      left,
      overlapping: await overlapping.getChainId(),
      redirected: await redirected.getChainId(),
      repeated: await repeated.getChainId(),
      selected: await selected.getChainId(),
      together: await together.getChainId(),
      switched: await switched.getChainId(),
    }).toMatchInlineSnapshot(`
      {
        "direct": 31318,
        "later": 42431,
        "left": "wagmi.SignInIncompleteError",
        "overlapping": 4217,
        "redirected": 42431,
        "repeated": 4217,
        "selected": 42431,
        "switched": 31318,
        "together": 4217,
      }
    `)
    void second
  })

  test('keeps the earlier chain of a held session after a `connect` with `chainId` that the user closes', async () => {
    const config = createConfig({
      chains: [tempo, tempoModerato],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          plugins: [email()],
          store: await sessionStore(),
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: {
        [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
        [tempoModerato.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
      },
    })
    const connector = config.connectors[0]!

    const closed = await connector
      .connect({
        accessKey: { expiry: Math.floor(Date.now() / 1000) + 86400 },
        chainId: tempoModerato.id,
        signIn: () =>
          Promise.reject(
            new DOMException('The user closed the sign-in.', 'AbortError'),
          ),
      } as never)
      .catch((error: Error) => error.name)
    const instance = await connector.getInstance()

    expect({
      accessKey: Number((await instance.session.get())?.accessKey?.chainId),
      chainId: await connector.getChainId(),
      closed,
    }).toMatchInlineSnapshot(`
      {
        "accessKey": 4217,
        "chainId": 4217,
        "closed": "UserRejectedRequestError",
      }
    `)
  })

  test('keeps the earlier chain, also in the store, after a `connect` with `chainId` that the user closes', async () => {
    const store = Store.memory()
    const create = () =>
      createConfig({
        chains: [tempo, tempoModerato],
        connectors: [
          tempoId({
            clientId: 'https://app.example.com',
            plugins: [email()],
            store,
            url: 'http://127.0.0.1:9',
          }),
        ],
        transports: {
          [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
          [tempoModerato.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
        },
      })
    const config = create()
    // The user closes the dialog of the sign-in on Tempo testnet.
    const closed = await connect(config, {
      chainId: tempoModerato.id,
      connector: config.connectors[0]!,
      signIn: () =>
        Promise.reject(
          new DOMException('The user closed the sign-in.', 'AbortError'),
        ),
    } as never).catch((error: Error) => error.name)
    const after = await config.connectors[0]!.getChainId()

    // The next load, such as a reload of the page, reads the stored selection.
    const reloaded = create()
    await reconnect(reloaded)
    let signIn: number | undefined
    await connect(reloaded, {
      connector: reloaded.connectors[0]!,
      signIn: (instance: tempoId.Instance) => {
        signIn = instance.config.chainId
        return Promise.reject(
          new DOMException('The user closed the sign-in.', 'AbortError'),
        )
      },
    } as never).catch(() => undefined)

    expect({
      after,
      closed,
      reloaded: await reloaded.connectors[0]!.getChainId(),
      signIn,
      wagmi: getChainId(reloaded),
    }).toMatchInlineSnapshot(`
      {
        "after": 4217,
        "closed": "UserRejectedRequestError",
        "reloaded": 4217,
        "signIn": 4217,
        "wagmi": 4217,
      }
    `)
  })

  test('refuses a connection outside a browser without `store` before it signs in', async () => {
    const config = createConfig({
      chains,
      connectors: [tempoId({ clientId: 'client_test' })],
      transports,
    })
    const connector = config.connectors[0]!
    const signIns: unknown[] = []

    const error = await connector
      .connect({
        signIn: (_instance, parameters) => {
          signIns.push(parameters)
          return Promise.resolve()
        },
      })
      .catch((error: Error) => error)

    expect(signIns).toMatchInlineSnapshot(`[]`)
    expect(error).toMatchInlineSnapshot(
      `[wagmi.StoreRequiredError: The instance holds no session outside a browser without \`store\`, so no sign-in connects. Pass \`store\`, such as \`Store.memory()\`.]`,
    )
  })

  test('refuses a connection outside a page with `store` and the default dialog before it signs in', async () => {
    const config = createConfig({
      chains,
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store: Store.memory(),
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports,
    })

    const error = await connect(config, {
      connector: config.connectors[0]!,
    }).catch((error: Error) => error)

    expect(error).toMatchInlineSnapshot(
      `[wagmi.SignInRequiredError: The connector has no sign-in plugin that signs in here without input: \`email\` and \`backend\` take input, and \`dialog\` needs a page. Pass \`signIn\` to \`connect\`, or add the \`passkey\`, \`redirect\`, or \`device\` plugin.]`,
    )
  })

  test('signs in outside a page with the first plugin after `dialog` that takes no input', async () => {
    const config = createConfig({
      chains,
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          plugins: [dialog(), device({ onCode() {} })],
          store: Store.memory(),
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports,
    })

    const error = await connect(config, {
      connector: config.connectors[0]!,
    }).catch((error: Error) => error)

    expect(error).toMatchInlineSnapshot(
      `[Accounts.RequestError: The code request received no response. Check the connection, and request a new code.]`,
    )
  })

  test('throws for a `chainId` that names no chain of the config', () => {
    const error = (() => {
      try {
        createConfig({
          chains: [tempo],
          connectors: [
            tempoId({ chainId: tempoDevnet.id, clientId: 'client_test' }),
          ],
          transports: { [tempo.id]: http() },
        })
      } catch (error) {
        return error
      }
    })()

    expect(error).toMatchInlineSnapshot(
      `[wagmi.ChainNotConfiguredError: Invalid chain: 31318 is not a chain of the config. Add the chain to the config's \`chains\`, or set \`chainId\` to one of them.]`,
    )
  })

  test("reads no Tempo Account for a third-party client ID's session without an access key", async () => {
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          // A closed port: a read of the account rejects, as a page on another site without a CORS
          // grant does.
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })

    await reconnect(config)
    const { status } = getConnection(config)
    const error = await config.connectors[0]!.connect().catch(
      (error: Error) => error,
    )

    expect(status).toMatchInlineSnapshot(`"disconnected"`)
    expect(error).toMatchInlineSnapshot(
      `[wagmi.AccountUnavailableError: The session holds no access key, and Tempo ID returned no Tempo Account for the app on the chain. Sign in with \`accessKey\`, or on a page of a realm that creates accounts.]`,
    )
  })

  test("switches the chain of a third-party client ID's session without an access key, with no account read", async () => {
    const store = Store.memory()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      {
        state: {
          session: Session.from({
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const config = createConfig({
      chains: [tempo, tempoDevnet],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          // A closed port: a read of the account rejects, as a page on another site without a CORS
          // grant does.
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: {
        [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
        [tempoDevnet.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
      },
    })
    const connector = config.connectors[0]!

    const switched = await connector.switchChain!({
      chainId: tempoDevnet.id,
    }).then(
      (chain) => chain.id,
      (error: Error) => error,
    )
    const chainId = await connector.getChainId()

    expect(switched).toMatchInlineSnapshot(`31318`)
    expect(chainId).toMatchInlineSnapshot(`31318`)
  })

  test('skips a stored session that another DPoP key binds at `reconnect`, and signs in again at `connect`', async () => {
    // A DPoP token names the thumbprint of its DPoP key in `cnf.jkt`, such as the DPoP key of an
    // earlier process whose `dpop` plugin kept no DPoP key in the store. Every request of the
    // session refuses that token, and only a sign-in replaces it.
    const accessToken = [
      { alg: 'RS256', typ: 'at+jwt' },
      { cnf: { jkt: Dpop.thumbprint(await Dpop.create()) }, sub: 'user_1' },
    ]
      .map((part) =>
        Base64.fromString(JSON.stringify(part), { pad: false, url: true }),
      )
      .concat('signature')
      .join('.')
    const store = await sessionStore({ accessToken })
    const requests: string[] = []
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'tempo-example-web',
          dpop: await Dpop.create(),
          fetch: (input, init) => {
            requests.push(new URL(String(input)).pathname)
            return globalThis.fetch(input, init)
          },
          plugins: [email()],
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    const connector = config.connectors[0]!

    const authorized = await connector.isAuthorized()
    await reconnect(config)
    const { status } = getConnection(config)
    // The sign-in starts with a code to the user's email, whose request reaches the closed port.
    const connected = await connect(config, {
      connector,
      signIn: (instance: tempoId.Instance<[ReturnType<typeof email>]>) =>
        instance.email.sendCode({ email: 'user@example.com' }),
    } as never).then(
      () => 'connected',
      (error: Error) => error.name,
    )

    expect({ authorized, connected, requests, status }).toMatchInlineSnapshot(`
        {
          "authorized": false,
          "connected": "Accounts.RequestError",
          "requests": [
            "/v1/auth/code",
          ],
          "status": "disconnected",
        }
      `)
  })

  test('signs with the access key for a call that names the connected account by address, and keeps the members of each action', async () => {
    const store = await sessionStore()
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      // A closed port: a call that reaches the RPC rejects.
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const { address } = getConnection(config)
    const client = await config.connectors[0]!.getClient!()
    const typedData = {
      domain: { name: 'Example' },
      message: { contents: 'hello' },
      primaryType: 'Mail',
      types: { Mail: [{ name: 'contents', type: 'string' }] },
    } as const

    const message = await signMessage(config, { message: 'hello' })
    const messageNamed = await signMessage(config, {
      account: address!,
      message: 'hello',
    }).catch((error: Error) => error.name)
    const wallet = await getWalletClient(config)
    const walletNamed = await wallet
      .signMessage({ account: address!, message: 'hello' })
      .catch((error: Error) => error.name)
    const scopedNamed = await wallet
      .scope({ signal: new AbortController().signal })
      .signMessage({ account: address!, message: 'hello' })
      .catch((error: Error) => error.name)
    const deployed = await wallet
      .deployContract({ abi: [], account: address!, bytecode: '0x00' })
      // The closed port refuses the first request, which names the path that the call took.
      .catch((error: Error) => /"method":"(\w+)"/.exec(error.message)?.[1])
    const transferred = await (
      client as unknown as {
        token: { transferSync: (parameters: unknown) => Promise<unknown> }
      }
    ).token
      .transferSync({
        account: address!,
        amount: 1n,
        to: '0x0000000000000000000000000000000000000001',
        token: '0x20c0000000000000000000000000000000000000',
      })
      .catch((error: Error) => /"method":"(\w+)"/.exec(error.message)?.[1])
    const funded = await (
      client as unknown as {
        faucet: { fundSync: (parameters: unknown) => Promise<unknown> }
      }
    ).faucet
      .fundSync({ account: address! })
      .catch((error: Error) => /"method":"(\w+)"/.exec(error.message)?.[1])
    const authorized = await (
      client as unknown as {
        accessKey: {
          signAuthorization: (parameters: unknown) => Promise<unknown>
        }
      }
    ).accessKey
      .signAuthorization({
        account: address!,
        expiry: Math.floor(Date.now() / 1000) + 3600,
        key: '0x0000000000000000000000000000000000000002',
        owner: privateKeyToAccount(generatePrivateKey()),
      })
      .catch((error: Error) => error.name)
    const typed = await signTypedData(config, typedData)
    const typedNamed = await signTypedData(config, {
      ...typedData,
      account: address!,
    }).catch((error: Error) => error.name)

    expect(messageNamed === message).toMatchInlineSnapshot(`true`)
    expect(walletNamed === message).toMatchInlineSnapshot(`true`)
    expect(scopedNamed === message).toMatchInlineSnapshot(`true`)
    expect(deployed).toMatchInlineSnapshot(`"eth_call"`)
    expect(transferred).toMatchInlineSnapshot(`"eth_call"`)
    expect(funded).toMatchInlineSnapshot(`"tempo_fundAddress"`)
    expect(authorized).toMatchInlineSnapshot(`"HttpRequestError"`)
    expect(typedNamed === typed).toMatchInlineSnapshot(`true`)
    expect(
      typeof (
        client as unknown as { token: { transfer: { estimateGas: unknown } } }
      ).token.transfer.estimateGas,
    ).toMatchInlineSnapshot(`"function"`)
  })

  test('sends the calls of `sendCalls`, `sendCallsSync`, and tree-shakable actions with the access key, for a call that names the connected account', async () => {
    const methods: string[] = []
    const store = await sessionStore()
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: {
        // An RPC without EIP-5792, which refuses every other method.
        [tempo.id]: custom(
          {
            request(args) {
              methods.push(args.method)
              if (args.method === 'eth_chainId')
                return Promise.resolve('0x1079')
              if (args.method === 'wallet_sendCalls')
                return Promise.reject(
                  new MethodNotSupportedRpcError(new Error(args.method)),
                )
              return Promise.reject(new Error('Method not supported.'))
            },
          },
          { retryCount: 0 },
        ),
      },
    })
    await reconnect(config)
    const { address } = getConnection(config)

    await sendCalls(config, {
      account: address!,
      calls: [{ to: '0x0000000000000000000000000000000000000001' }],
      experimental_fallback: true,
    }).catch(() => undefined)
    const client = await config.connectors[0]!.getClient!()
    await (
      client as unknown as {
        sendCallsSync: (parameters: unknown) => Promise<unknown>
      }
    )
      .sendCallsSync({
        account: address!,
        calls: [{ to: '0x0000000000000000000000000000000000000001' }],
        experimental_fallback: true,
      })
      .catch(() => undefined)
    // Viem's tree-shakable actions, such as `token.grantRolesSync`, send the address as a
    // JSON-RPC account.
    await Actions.token
      .grantRolesSync(
        client as never,
        {
          account: address!,
          roles: ['issuer'],
          to: '0x0000000000000000000000000000000000000001',
          token: '0x20c0000000000000000000000000000000000000',
        } as never,
      )
      .catch(() => undefined)
    const signed = await signTransaction(
      client as never,
      {
        account: address!,
        calls: [{ to: '0x0000000000000000000000000000000000000001' }],
        feeToken: '0x20c0000000000000000000000000000000000000',
        gas: 100_000n,
        maxFeePerGas: 1n,
        maxPriorityFeePerGas: 1n,
        nonce: 0,
      } as never,
    ).catch((error: Error) => error.name)

    expect(methods.includes('eth_sendTransaction')).toMatchInlineSnapshot(
      `false`,
    )
    expect(methods.includes('eth_signTransaction')).toMatchInlineSnapshot(
      `false`,
    )
    expect(String(signed).slice(0, 4)).toMatchInlineSnapshot(`"0x76"`)
  })

  test('stops a call that names the connected account by address on a scope whose signal aborted', async () => {
    const methods: string[] = []
    const store = await sessionStore()
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: {
        // An RPC that records each request that reaches it, and refuses every method but the chain's.
        [tempo.id]: custom(
          {
            request(args) {
              methods.push(args.method)
              if (args.method === 'eth_chainId')
                return Promise.resolve('0x1079')
              return Promise.reject(new Error('Method not supported.'))
            },
          },
          { retryCount: 0 },
        ),
      },
    })
    await reconnect(config)
    const { address } = getConnection(config)
    const client = await config.connectors[0]!.getClient!()
    const controller = new AbortController()
    controller.abort()
    const scoped = (
      client as unknown as {
        scope: (options: { signal: AbortSignal }) => unknown
      }
    ).scope({ signal: controller.signal })
    methods.length = 0

    // Without `chain`, Viem reads no chain ID, so the wallet request is the call's first request.
    const error = await sendTransaction(
      scoped as never,
      {
        account: address!,
        chain: null,
        to: '0x0000000000000000000000000000000000000001',
      } as never,
    ).catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"TransactionExecutionError"`)
    expect(methods).toMatchInlineSnapshot(`[]`)
  })

  test('reconnects to a session that another context saved with the DPoP key of the connector, over a held session that another DPoP key binds', async () => {
    const dpop = await Dpop.create()
    const token = (key: Dpop.Dpop) =>
      [
        { alg: 'RS256', typ: 'at+jwt' },
        { cnf: { jkt: Dpop.thumbprint(key) }, sub: 'user_1' },
      ]
        .map((part) =>
          Base64.fromString(JSON.stringify(part), { pad: false, url: true }),
        )
        .concat('signature')
        .join('.')
    const store = await sessionStore({
      accessToken: token(await Dpop.create()),
    })
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          dpop,
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    const connector = config.connectors[0]!
    await reconnect(config)
    const before = getConnection(config).status

    // Another context with the same DPoP key, such as another process, saves its sign-in.
    await store.setItem(
      key,
      await (await sessionStore({ accessToken: token(dpop) })).getItem(key),
    )
    const authorized = await connector.isAuthorized()
    await reconnect(config)

    expect({ after: getConnection(config).status, authorized, before })
      .toMatchInlineSnapshot(`
        {
          "after": "connected",
          "authorized": true,
          "before": "disconnected",
        }
      `)
  })

  test("reconnects to a session that another instance saved to the shared store after the connector's first read", async () => {
    const store = Store.memory()
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const saved = await (await sessionStore()).getItem(key)
    const signIns: string[] = []
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          plugins: [
            Plugin.from({
              hooks: {
                afterSignIn: (_context, session) => {
                  signIns.push(session.user!.id)
                },
              },
              id: 'record',
            }),
          ],
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const before = getConnection(config).status

    // Another instance on the store, such as one of another process, saves its sign-in.
    await store.setItem(key, saved)
    await reconnect(config)

    expect({ after: getConnection(config).status, before })
      .toMatchInlineSnapshot(`
      {
        "after": "connected",
        "before": "disconnected",
      }
    `)
    await expect.poll(() => signIns).toEqual(['user_1'])
  })

  test("disconnects at `reconnect` once another process's sign-out empties the shared `Store.file`", async () => {
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const path = Path.join(
      await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-')),
      'store.json',
    )
    await Store.file(path).setItem(
      key,
      await (await sessionStore()).getItem(key),
    )
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store: Store.file(path),
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    const connector = config.connectors[0]!
    await reconnect(config)
    const before = getConnection(config).status

    // Another process on the file, such as a second run of a CLI, signs out.
    await Store.file(path).setItem(key, { state: {}, version: 0 })
    const authorized = await connector.isAuthorized()
    await reconnect(config)

    expect({
      accounts: await connector.getAccounts(),
      after: getConnection(config).status,
      authorized,
      before,
    }).toMatchInlineSnapshot(`
      {
        "accounts": [],
        "after": "disconnected",
        "authorized": false,
        "before": "connected",
      }
    `)
  })

  test('reads the shared `Store.file` once at `reconnect` with a held session', async () => {
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const path = Path.join(
      await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-')),
      'store.json',
    )
    const file = Store.file(path)
    await file.setItem(key, await (await sessionStore()).getItem(key))
    const reads: string[] = []
    const store = Store.from({
      ...file,
      async getItem(name) {
        if (name === key) reads.push(name)
        return file.getItem(name)
      },
    })
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    reads.length = 0

    await reconnect(config)

    expect({
      reads: reads.length,
      status: getConnection(config).status,
    }).toMatchInlineSnapshot(`
      {
        "reads": 1,
        "status": "connected",
      }
    `)
  })

  test('rejects at `reconnect` a session that another process signs out after an earlier load reads it', async () => {
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const path = Path.join(
      await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-')),
      'store.json',
    )
    const file = Store.file(path)
    await file.setItem(key, await (await sessionStore()).getItem(key))
    const gate = Promise.withResolvers<void>()
    const read = Promise.withResolvers<void>()
    const store = Store.from({
      ...file,
      async getItem(name) {
        const value = await file.getItem(name)
        if (name !== key) return value
        read.resolve()
        await gate.promise
        return value
      },
    })
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    const instance = await config.connectors[0]!.getInstance()
    const load = instance.session.get()
    await read.promise
    await Store.file(path).removeItem(key)

    const reconnected = reconnect(config)
    gate.resolve()
    await Promise.all([load, reconnected])

    expect(getConnection(config).status).toMatchInlineSnapshot(`"disconnected"`)
  })

  test('reads the shared `Store.file` once at the first `reconnect` of a process', async () => {
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const path = Path.join(
      await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-')),
      'store.json',
    )
    const file = Store.file(path)
    await file.setItem(key, await (await sessionStore()).getItem(key))
    const reads: string[] = []
    const store = Store.from({
      ...file,
      async getItem(name) {
        if (name === key) reads.push(name)
        return file.getItem(name)
      },
    })
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })

    await reconnect(config)

    expect({
      reads: reads.length,
      status: getConnection(config).status,
    }).toMatchInlineSnapshot(`
      {
        "reads": 1,
        "status": "connected",
      }
    `)
  })

  test('reads the shared `Store.file` once at the first `connect` of a process with a held session, also with `chainId`', async () => {
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'
    const path = Path.join(
      await Fs.mkdtemp(Path.join(Os.tmpdir(), 'accounts-')),
      'store.json',
    )
    const file = Store.file(path)
    await file.setItem(key, await (await sessionStore()).getItem(key))
    const reads: string[] = []
    const store = Store.from({
      ...file,
      async getItem(name) {
        if (name === key) reads.push(name)
        return file.getItem(name)
      },
    })
    async function connectOnce(chainId?: typeof tempo.id) {
      const config = createConfig({
        chains: [tempo],
        connectors: [
          tempoId({
            clientId: 'https://app.example.com',
            store,
            url: 'http://127.0.0.1:9',
          }),
        ],
        transports: {
          [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }),
        },
      })
      reads.length = 0

      await connect(config, { chainId, connector: config.connectors[0]! })

      return {
        chainId: chainId ?? null,
        reads: reads.length,
        status: getConnection(config).status,
      }
    }

    const results = [await connectOnce(), await connectOnce(tempo.id)]

    expect(results).toMatchInlineSnapshot(`
      [
        {
          "chainId": null,
          "reads": 1,
          "status": "connected",
        },
        {
          "chainId": 4217,
          "reads": 1,
          "status": "connected",
        },
      ]
    `)
  })

  test('rejects a call that names the connected account by address once the session ends', async () => {
    const store = await sessionStore()
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      // A closed port: a call that reaches the RPC rejects.
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const { address } = getConnection(config)
    const connector = config.connectors[0]!
    const client = await connector.getClient!()
    await (await connector.getInstance()).signOut()

    const error = await (
      client as unknown as {
        signMessage: (parameters: unknown) => Promise<unknown>
      }
    )
      .signMessage({ account: address!, message: 'hello' })
      .catch((error: Error) => error.name)

    expect(error).toMatchInlineSnapshot(`"Accounts.SignedOutError"`)
  })

  test("disconnects at the access key's expiry, as the session's status signs out, and once", async () => {
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store: await sessionStore({ expiresIn: 2 }),
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const connector = config.connectors[0]!
    const instance = await connector.getInstance()
    const provider = (await connector.getProvider()) as {
      on: (event: 'disconnect', listener: () => void) => void
    }
    const events: string[] = []
    config.subscribe(
      (state) => state.status,
      (status) => events.push(`wagmi:${status}`),
    )
    instance.session.status.subscribe((status) =>
      events.push(`session:${status.status}`),
    )
    provider.on('disconnect', () => events.push('provider:disconnect'))

    await expect
      .poll(() => instance.session.status.get().status, { timeout: 5_000 })
      .toBe('signedOut')
    const expired = getConnection(config).status
    // A later read empties the expired session, and ends nothing again.
    events.push('read')
    const accounts = await connector.getAccounts()

    expect({
      accounts,
      events,
      expired,
      status: getConnection(config).status,
    }).toMatchInlineSnapshot(`
      {
        "accounts": [],
        "events": [
          "wagmi:disconnected",
          "provider:disconnect",
          "session:signedOut",
          "read",
        ],
        "expired": "disconnected",
        "status": "disconnected",
      }
    `)
  }, 10_000)

  /**
   * Returns a wagmi config whose session's access key expires in 2 seconds, and the events of wagmi,
   * the session's status, and the provider after the expiry.
   */
  async function expiring(options: { owner: `0x${string}` }) {
    const store = await sessionStore({ expiresIn: 2, owner: options.owner })
    const config = createConfig({
      chains: [tempo],
      connectors: [
        tempoId({
          clientId: 'https://app.example.com',
          store,
          url: 'http://127.0.0.1:9',
        }),
      ],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const connector = config.connectors[0]!
    const instance = await connector.getInstance()
    const provider = (await connector.getProvider()) as {
      on: (
        event: 'accountsChanged' | 'disconnect',
        listener: () => void,
      ) => void
    }
    await expect
      .poll(() => instance.session.status.get().status, { timeout: 5_000 })
      .toBe('signedOut')
    const events: string[] = []
    config.subscribe(
      (state) => state.status,
      (status) => events.push(`wagmi:${status}`),
    )
    provider.on('accountsChanged', () =>
      events.push('provider:accountsChanged'),
    )
    provider.on('disconnect', () => events.push('provider:disconnect'))
    return { config, connector, events, instance, store }
  }

  test("connects again when the same account's valid session replaces the expired one", async () => {
    const owner = Secp256k1.randomPrivateKey()
    const { config, connector, events, store } = await expiring({ owner })
    const key =
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]'

    // Another tab saves a valid session of the same account, which a read adopts.
    await store.setItem(key, await (await sessionStore({ owner })).getItem(key))
    const accounts = await connector.getAccounts()

    await expect.poll(() => getConnection(config).status).toBe('connected')
    expect({ accounts: accounts.length, events }).toMatchInlineSnapshot(`
      {
        "accounts": 1,
        "events": [
          "provider:accountsChanged",
          "wagmi:connected",
        ],
      }
    `)
  }, 10_000)

  test('keeps wagmi connected while an authorization runs across the expiry, and disconnects once when it fails', async () => {
    // A server that holds each request open until the test drops its connection.
    const held: Net.Socket[] = []
    const server = Http.createServer((request) => held.push(request.socket))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const url = `http://127.0.0.1:${(server.address() as Net.AddressInfo).port}`
    // A first-party app authorizes headlessly, so its authorization waits for the request.
    const store = await sessionStore({ expiresIn: 2 })
    await store.setItem(
      `tempo-id:session:["${url}","client_1",4217]`,
      await store.getItem(
        'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
      ),
    )
    const config = createConfig({
      chains: [tempo],
      connectors: [tempoId({ clientId: 'client_1', store, url })],
      transports: { [tempo.id]: http('http://127.0.0.1:9', { retryCount: 0 }) },
    })
    await reconnect(config)
    const connector = config.connectors[0]!
    const instance = await connector.getInstance()
    const provider = (await connector.getProvider()) as {
      on: (event: 'disconnect', listener: () => void) => void
    }
    const events: string[] = []
    provider.on('disconnect', () => events.push('provider:disconnect'))

    const authorization = instance.authorize().then(
      () => undefined,
      (error: Error) => error.name,
    )
    await expect
      .poll(
        () =>
          InternalSession.machines.expired(
            instance.session.actor!.getSnapshot(),
          ),
        { timeout: 5_000 },
      )
      .toBe(true)
    const during = getConnection(config).status
    for (const socket of held) socket.destroy()
    const error = await authorization
    server.close()

    expect({
      after: getConnection(config).status,
      during,
      error,
      events,
    }).toMatchInlineSnapshot(`
      {
        "after": "disconnected",
        "during": "connected",
        "error": "Accounts.RequestError",
        "events": [
          "provider:disconnect",
        ],
      }
    `)
  }, 10_000)

  test('disconnects once when a renewal after the expiry fails', async () => {
    const { events, instance } = await expiring({
      owner: Secp256k1.randomPrivateKey(),
    })

    const error = await instance.authorize().then(
      () => undefined,
      (error: Error) => error.name,
    )

    expect({ error, events }).toMatchInlineSnapshot(`
      {
        "error": "Accounts.RequestError",
        "events": [],
      }
    `)
  }, 10_000)
})

describe('wagmi', () => {
  test("sends the session's access token on the owner's account read without a `viem` plugin", async () => {
    const store = Store.memory()
    const owner = Secp256k1.randomPrivateKey()
    await store.setItem(
      'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",42431]',
      {
        state: {
          session: Session.from({
            accessKey: createAccessKey({ chainId: 4217, owner }),
            accessToken: 'access-token',
            expiresAt: Date.now() + 60 * 60 * 1000,
            refreshToken: 'refresh-token',
            user: { email: 'user@example.com', id: 'user_1' },
          }),
        },
        version: 0,
      },
    )
    const requests: string[] = []
    const accounts = Accounts.create({
      chain: 42431,
      clientId: 'https://app.example.com',
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
        const request = new Request(input, init)
        requests.push(
          `${request.method} ${new URL(request.url).pathname} ${request.headers.get('authorization')}`,
        )
        return Promise.resolve(
          Response.json({ error: 'temporarily_unavailable' }, { status: 503 }),
        )
      }) as typeof globalThis.fetch,
      plugins: [wagmi()],
      store,
      url: 'http://127.0.0.1:9',
    })
    await accounts.session.get()

    // The session's access key is on another chain, so the owner signs, and the signature reads
    // the account first.
    await accounts.viem.account
      .signMessage({ message: 'hello' })
      .catch((error: unknown) => error)

    expect(requests).toMatchInlineSnapshot(`
      [
        "GET /v1/account Bearer access-token",
      ]
    `)
  })
})

describe('machines.connect', () => {
  test('selects the chain before a failed call again, only for the latest call and without another switch or session', () => {
    const [initial] = initialTransition(machines.connect)

    const switched = step(initial, {
      chainId: tempo.id,
      target: tempoModerato.id,
      type: 'connect.start',
    })
    const own = step(switched, {
      chainId: tempoModerato.id,
      type: 'chain.change',
    })
    const other = step(switched, {
      chainId: tempoDevnet.id,
      type: 'chain.change',
    })
    const session = step(switched, { type: 'session.change' })
    const later = step(switched, {
      chainId: tempoModerato.id,
      target: tempoDevnet.id,
      type: 'connect.start',
    })
    const ended = step(later, { attempt: 1, type: 'connect.end' })
    const plain = step(switched, {
      chainId: undefined,
      target: undefined,
      type: 'connect.start',
    })
    const queued = step(switched, { type: 'chain.switch' })

    expect({
      ended: machines.earlier(ended, 2),
      first: machines.earlier(later, 1),
      initial: machines.earlier(initial, 0),
      later: machines.earlier(later, 2),
      other: machines.earlier(other, 1),
      own: machines.earlier(own, 1),
      plain: machines.earlier(plain, 1),
      queued: machines.earlier(queued, 1),
      session: machines.earlier(session, 1),
      switched: machines.earlier(switched, 1),
    }).toMatchInlineSnapshot(`
      {
        "ended": 4217,
        "first": undefined,
        "initial": undefined,
        "later": 4217,
        "other": undefined,
        "own": 4217,
        "plain": undefined,
        "queued": undefined,
        "session": undefined,
        "switched": 4217,
      }
    `)
    expect(ended.value).toMatchInlineSnapshot(`"switched"`)
  })

  test('reaches every state along its shortest paths, handles every event type, and agrees with `select`', () => {
    const snapshots = getShortestPaths(machines.connect, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "idle",
        "switched",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    expect(
      snapshots.every(
        (snapshot) =>
          machines.select(snapshot.context) === snapshot.value &&
          (snapshot.context.chainId !== undefined ||
            snapshot.context.pending.length === 0),
      ),
    ).toBe(true)
  })

  /** Returns the snapshot after `steps`, in order, from `snapshot`. */
  function step(
    snapshot: machines.connect.Snapshot,
    ...steps: readonly machines.connect.Event[]
  ) {
    return steps.reduce(
      (current, event) => getNextSnapshot(machines.connect, current, event),
      snapshot,
    )
  }

  /**
   * The events of each type that the connector sends from a snapshot. A call that ends is the
   * latest call or the call before it.
   */
  const events: {
    [type in machines.connect.Event['type']]: (
      snapshot: machines.connect.Snapshot,
    ) => readonly machines.connect.Event[]
  } = {
    'chain.change': () => [
      { chainId: tempoModerato.id, type: 'chain.change' },
      { chainId: tempoDevnet.id, type: 'chain.change' },
    ],
    'chain.switch': () => [{ type: 'chain.switch' }],
    'connect.end': (snapshot) => [
      { attempt: snapshot.context.attempt, type: 'connect.end' },
      { attempt: snapshot.context.attempt - 1, type: 'connect.end' },
    ],
    'connect.start': () => [
      { chainId: tempo.id, target: tempoModerato.id, type: 'connect.start' },
      { chainId: undefined, target: undefined, type: 'connect.start' },
    ],
    'session.change': () => [{ type: 'session.change' }],
  }

  /** The traversal of {@link getShortestPaths}, over every event that {@link events} offers. */
  const traversal = {
    events: (snapshot: machines.connect.Snapshot) => [
      ...events['chain.change'](snapshot),
      ...events['chain.switch'](snapshot),
      ...events['connect.end'](snapshot),
      ...events['connect.start'](snapshot),
      ...events['session.change'](snapshot),
    ],
    serializeState: (snapshot: machines.connect.Snapshot) =>
      JSON.stringify(snapshot.value),
  }
})

describe('machines.disconnect', () => {
  test('signs out until the last of two overlapping sign-outs settles', () => {
    const [initial] = initialTransition(machines.disconnect)

    const first = step(initial, { type: 'signOut.start' })
    const second = step(first, { type: 'signOut.start' })
    const one = step(second, { type: 'signOut.finish' })
    const none = step(one, { type: 'signOut.finish' })

    expect(initial.value).toMatchInlineSnapshot(`"idle"`)
    expect(first.value).toMatchInlineSnapshot(`"signingOut"`)
    expect(one.value).toMatchInlineSnapshot(`"signingOut"`)
    expect(one.context.runs).toMatchInlineSnapshot(`1`)
    expect(none.value).toMatchInlineSnapshot(`"idle"`)
    expect(machines.signingOut(one)).toMatchInlineSnapshot(`true`)
    expect(machines.signingOut(none)).toMatchInlineSnapshot(`false`)
  })

  test('holds the ended session after a failed sign-out, until a retry or a change of the session', () => {
    const [initial] = initialTransition(machines.disconnect)

    const failed = step(
      initial,
      { type: 'signOut.start' },
      { type: 'signOut.fail' },
    )
    const changed = step(failed, { type: 'session.change' })
    const retried = step(
      failed,
      { type: 'signOut.start' },
      { type: 'signOut.finish' },
    )

    expect(failed.value).toMatchInlineSnapshot(`"held"`)
    expect(machines.held(failed)).toMatchInlineSnapshot(`true`)
    expect(machines.stale(failed)).toMatchInlineSnapshot(`true`)
    expect(changed.value).toMatchInlineSnapshot(`"idle"`)
    expect(machines.stale(changed)).toMatchInlineSnapshot(`false`)
    expect(retried.value).toMatchInlineSnapshot(`"idle"`)
  })

  test("ends a connected session once at its access keys' expiry, until a change of the session", () => {
    const ended: string[] = []
    const actor = createActor(
      machines.disconnect.provide({
        actions: { end: () => ended.push('end') },
      }),
    ).start()

    actor.send({ connected: true, type: 'session.expire' })
    actor.send({ connected: true, type: 'session.expire' })
    const expired = actor.getSnapshot()
    actor.send({ type: 'session.change' })
    const changed = actor.getSnapshot()
    actor.send({ connected: false, type: 'session.expire' })

    expect(expired.value).toMatchInlineSnapshot(`"expired"`)
    expect(machines.expired(expired)).toMatchInlineSnapshot(`true`)
    expect(machines.stale(expired)).toMatchInlineSnapshot(`false`)
    expect(changed.value).toMatchInlineSnapshot(`"idle"`)
    expect(actor.getSnapshot().value).toMatchInlineSnapshot(`"idle"`)
    expect(ended).toMatchInlineSnapshot(`
      [
        "end",
      ]
    `)
  })

  test('reaches every state along its shortest paths, handles every event type, and counts sign-outs only while it signs out', () => {
    const snapshots = getShortestPaths(machines.disconnect, traversal).map(
      (path) => path.state,
    )

    const reached = new Set(snapshots.map((snapshot) => snapshot.value))
    const handled = new Set(
      snapshots.flatMap((snapshot) =>
        traversal
          .events(snapshot)
          .filter((event) => snapshot.can(event))
          .map((event) => event.type),
      ),
    )

    expect([...reached].sort()).toMatchInlineSnapshot(`
      [
        "expired",
        "held",
        "idle",
        "signingOut",
      ]
    `)
    expect([...handled].sort()).toEqual(Object.keys(events).sort())
    expect(
      snapshots.every(
        (snapshot) =>
          machines.signingOut(snapshot) === snapshot.context.runs > 0,
      ),
    ).toBe(true)
  })

  /** Returns the snapshot after `steps`, in order, from `snapshot`. */
  function step(
    snapshot: machines.disconnect.Snapshot,
    ...steps: readonly machines.disconnect.Event[]
  ) {
    return steps.reduce(
      (current, event) => getNextSnapshot(machines.disconnect, current, event),
      snapshot,
    )
  }

  /**
   * The events of each type that the connector sends from a snapshot. A sign-out settles only while
   * one runs, and the traversal starts at most two overlapping sign-outs.
   */
  const events: {
    [type in machines.disconnect.Event['type']]: (
      snapshot: machines.disconnect.Snapshot,
    ) => readonly machines.disconnect.Event[]
  } = {
    'session.change': () => [{ type: 'session.change' }],
    'session.expire': () => [
      { connected: false, type: 'session.expire' },
      { connected: true, type: 'session.expire' },
    ],
    'signOut.fail': (snapshot) =>
      snapshot.context.runs > 0 ? [{ type: 'signOut.fail' }] : [],
    'signOut.finish': (snapshot) =>
      snapshot.context.runs > 0 ? [{ type: 'signOut.finish' }] : [],
    'signOut.start': (snapshot) =>
      snapshot.context.runs < 2 ? [{ type: 'signOut.start' }] : [],
  }

  /** The traversal of the machine's graph, keyed by the state. */
  const traversal = {
    events: (snapshot: machines.disconnect.Snapshot) => [
      ...events['session.change'](snapshot),
      ...events['session.expire'](snapshot),
      ...events['signOut.fail'](snapshot),
      ...events['signOut.finish'](snapshot),
      ...events['signOut.start'](snapshot),
    ],
    serializeState: (snapshot: machines.disconnect.Snapshot) =>
      JSON.stringify(snapshot.value),
  }
})

/**
 * Returns a store that holds a session of `user_1` with an access key on Tempo mainnet, and
 * `accessToken` as its access token.
 */
async function sessionStore(
  options: {
    accessToken?: string
    expiresIn?: number
    owner?: `0x${string}` | undefined
  } = {},
) {
  const {
    accessToken = 'access-token',
    expiresIn = 3600,
    owner = Secp256k1.randomPrivateKey(),
  } = options
  const store = Store.memory()
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: BigInt(tempo.id),
    expiry: Math.floor(Date.now() / 1000) + expiresIn,
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: owner,
  })
  await store.setItem(
    'tempo-id:session:["http://127.0.0.1:9","https://app.example.com",4217]',
    {
      state: {
        session: Session.from({
          accessKey: {
            account: Address.fromPublicKey(
              Secp256k1.getPublicKey({ privateKey: owner }),
            ),
            chainId: tempo.id,
            keyAuthorization: KeyAuthorization.toRpc(
              KeyAuthorization.from(authorization, { signature }),
            ),
            privateKey,
          },
          accessToken,
          expiresAt: Date.now() + 60 * 60 * 1000,
          user: { email: 'user@example.com', id: 'user_1' },
        }),
      },
      version: 0,
    },
  )
  return store
}

/** Returns an access key on `chainId` that `owner` authorized, with its private key. */
function createAccessKey(options: { chainId: number; owner: `0x${string}` }) {
  const privateKey = Secp256k1.randomPrivateKey()
  const authorization = KeyAuthorization.from({
    address: Address.fromPublicKey(Secp256k1.getPublicKey({ privateKey })),
    chainId: BigInt(options.chainId),
    expiry: Math.floor(Date.now() / 1000) + 3600,
    type: 'secp256k1',
  })
  const signature = Secp256k1.sign({
    payload: KeyAuthorization.getSignPayload(authorization),
    privateKey: options.owner,
  })
  return {
    account: Address.fromPublicKey(
      Secp256k1.getPublicKey({ privateKey: options.owner }),
    ),
    chainId: options.chainId,
    keyAuthorization: KeyAuthorization.toRpc(
      KeyAuthorization.from(authorization, { signature }),
    ),
    privateKey,
  }
}
