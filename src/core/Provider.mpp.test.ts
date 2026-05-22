import { Challenge, Credential } from 'mppx'
import { Mppx } from 'mppx/client'
import { Hex } from 'ox'
import { KeyAuthorization, SignatureEnvelope } from 'ox/tempo'
import { custom } from 'viem'
import { toAccount } from 'viem/accounts'
import { Account as TempoAccount, Addresses } from 'viem/tempo'
import { tempoLocalnet } from 'viem/tempo/chains'
import { afterEach, describe, expect, test } from 'vp/test'

import { accounts, privateKeys } from '../../test/config.js'
import * as AccessKey from './AccessKey.js'
import type * as Account from './Account.js'
import * as Adapter from './Adapter.js'
import { local } from './adapters/local.js'
import * as MppAuthorization from './internal/MppAuthorization.js'
import * as Provider from './Provider.js'
import * as Storage from './Storage.js'

const rootAddress = accounts[0]!.address

afterEach(() => Mppx.restore())

describe('mpp_authorize', () => {
  test('error: rejects non-Tempo challenges', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [createChallenge({ intent: 'charge', method: 'stripe' })],
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Only Tempo payment challenges are supported.]`,
    )
  })

  test('error: rejects session continuation with multiple challenges', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({ intent: 'session', method: 'tempo' }),
              createChallenge({ intent: 'session', method: 'tempo' }),
            ],
            session: {
              action: 'voucher',
              authorizedSigner: rootAddress,
              channelId: '0x01',
              cumulativeAmount: '1',
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`session\` can only be used with one challenge.]`,
    )
  })

  test('error: rejects session channel mismatch', async () => {
    const provider = createProvider()

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'session',
                method: 'tempo',
                request: { methodDetails: { channelId: '0x02' } },
              }),
            ],
            session: {
              action: 'close',
              authorizedSigner: rootAddress,
              channelId: '0x01',
              cumulativeAmount: '1',
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: \`session.channelId\` conflicts with the payment challenge.]`,
    )
  })

  test('behavior: authorizes charge without recursive mpp_authorize', async () => {
    const provider = createProvider({ account: accounts[0]! })
    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'charge',
              method: 'tempo',
              request: {
                amount: '0',
                currency: Addresses.pathUsd,
                methodDetails: { chainId: tempoLocalnet.id },
                recipient: accounts[1]!.address,
              },
            }),
          ],
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as { type?: string | undefined }
    expect({
      challenge: credential.challenge.id,
      payloadType: payload.type,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "challenge": "tempo-charge",
        "payloadType": "proof",
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('behavior: authorizes session continuation with root signer', async () => {
    const provider = createProvider({ account: accounts[0]! })
    const channelId = Hex.padLeft('0x01', 32)
    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'session',
              method: 'tempo',
              request: {
                amount: '1',
                currency: Addresses.pathUsd,
                methodDetails: {
                  chainId: tempoLocalnet.id,
                  channelId,
                  escrowContract: accounts[2]!.address,
                },
                recipient: accounts[1]!.address,
              },
            }),
          ],
          session: {
            action: 'voucher',
            authorizedSigner: rootAddress,
            channelId,
            cumulativeAmount: '1',
          },
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as {
      action?: string | undefined
      channelId?: string | undefined
      cumulativeAmount?: string | undefined
      signature?: string | undefined
    }
    const { signature: _signature, ...payload_ } = payload
    expect({
      payload: payload_,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "payload": {
          "action": "voucher",
          "channelId": "0x0000000000000000000000000000000000000000000000000000000000000001",
          "cumulativeAmount": "1",
        },
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('error: rejects root signer mismatch', async () => {
    const provider = createProvider({
      adapter: Adapter.define({}, ({ getClient, mpp, store }) => ({
        actions: {
          async authorizeMpp(parameters) {
            if (!mpp) throw new Error('mpp not configured')
            return await MppAuthorization.authorize({
              createWalletClient: (() => {
                throw new Error('unexpected wallet client')
              }) as never,
              getClient,
              getRootAccount: async () => TempoAccount.fromSecp256k1(privateKeys[1]!),
              mpp,
              parameters,
              store,
            })
          },
          createAccount: async () => ({ accounts: [] }),
          async loadAccounts() {
            return { accounts: [] }
          },
          sendTransaction: async () => {
            throw new Error('unexpected sendTransaction')
          },
          sendTransactionSync: async () => {
            throw new Error('unexpected sendTransactionSync')
          },
          signPersonalMessage: async () => {
            throw new Error('unexpected signPersonalMessage')
          },
          signTransaction: async () => {
            throw new Error('unexpected signTransaction')
          },
          signTypedData: async () => {
            throw new Error('unexpected signTypedData')
          },
        },
      })),
      account: { address: rootAddress },
    })
    const channelId = Hex.padLeft('0x01', 32)

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'session',
                method: 'tempo',
                request: {
                  amount: '1',
                  currency: Addresses.pathUsd,
                  methodDetails: {
                    chainId: tempoLocalnet.id,
                    channelId,
                    escrowContract: accounts[2]!.address,
                  },
                  recipient: accounts[1]!.address,
                },
              }),
            ],
            session: {
              action: 'voucher',
              authorizedSigner: rootAddress,
              channelId,
              cumulativeAmount: '1',
            },
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[RpcResponse.InvalidParamsError: Root account does not match the authorized signer.]`,
    )
  })

  test('behavior: forwards JSON-RPC root account with native mpp_authorize support', async () => {
    const requests: { method: string; params?: unknown }[] = []
    const remote = {
      async request(request: { method: string; params?: unknown }) {
        requests.push(request)
        if (request.method === 'wallet_getCapabilities')
          return {
            [Hex.fromNumber(tempoLocalnet.id)]: {
              atomic: { status: 'supported' },
              mpp: { status: 'supported' },
            },
          }
        if (request.method === 'mpp_authorize') return { authorization: 'forwarded' }
        throw new Error(`unexpected request ${request.method}`)
      },
    }
    const provider = createProvider({
      adapter: Adapter.define({}, ({ getClient, mpp, store }) => ({
        actions: {
          async authorizeMpp(parameters) {
            if (!mpp) throw new Error('mpp not configured')
            return await MppAuthorization.authorize({
              createWalletClient: (() => {
                throw new Error('unexpected wallet client')
              }) as never,
              getClient,
              getRootAccount: async (address) => ({
                account: toAccount(address),
                provider: remote as never,
                transport: custom(remote as never),
              }),
              mpp,
              parameters,
              store,
            })
          },
          createAccount: async () => ({ accounts: [] }),
          async loadAccounts() {
            return { accounts: [] }
          },
          sendTransaction: async () => {
            throw new Error('unexpected sendTransaction')
          },
          sendTransactionSync: async () => {
            throw new Error('unexpected sendTransactionSync')
          },
          signPersonalMessage: async () => {
            throw new Error('unexpected signPersonalMessage')
          },
          signTransaction: async () => {
            throw new Error('unexpected signTransaction')
          },
          signTypedData: async () => {
            throw new Error('unexpected signTypedData')
          },
        },
      })),
      account: { address: rootAddress },
    })

    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'charge',
              method: 'tempo',
              request: {
                amount: '1',
                currency: Addresses.pathUsd,
                methodDetails: { chainId: tempoLocalnet.id },
                recipient: accounts[1]!.address,
              },
            }),
          ],
        },
      ],
    })

    const forwarded = requests[1]?.params as readonly [{ challenges: readonly string[] }]
    expect({
      challenge: forwarded[0].challenges[0],
      methods: requests.map((request) => request.method),
      result,
    }).toMatchInlineSnapshot(`
      {
        "challenge": "Payment id="tempo-charge", realm="example.test", method="tempo", intent="charge", request="eyJhbW91bnQiOiIxIiwiY3VycmVuY3kiOiIweDIwYzAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAiLCJtZXRob2REZXRhaWxzIjp7ImNoYWluSWQiOjEzMzd9LCJyZWNpcGllbnQiOiIweDhDOGQzNTQyOUY3NGVjMjQ1RjhFZjJmNEZkMWU1NTFjRkY5N2Q2NTAifQ"",
        "methods": [
          "wallet_getCapabilities",
          "mpp_authorize",
        ],
        "result": {
          "authorization": "forwarded",
        },
      }
    `)
  })

  test('behavior: signs with JSON-RPC account when native mpp_authorize is unsupported', async () => {
    const remote = {
      async request(request: { method: string }) {
        if (request.method === 'wallet_getCapabilities')
          return {
            [Hex.fromNumber(tempoLocalnet.id)]: {
              atomic: { status: 'supported' },
              mpp: { status: 'unsupported' },
            },
          }
        throw new Error(`unexpected request ${request.method}`)
      },
    }
    const provider = createProvider({
      adapter: Adapter.define({}, ({ getClient, mpp, store }) => ({
        actions: {
          async authorizeMpp(parameters) {
            if (!mpp) throw new Error('mpp not configured')
            return await MppAuthorization.authorize({
              createWalletClient: (() => {
                throw new Error('fallback signing')
              }) as never,
              getClient,
              getRootAccount: async (address) => ({
                account: toAccount(address),
                provider: remote as never,
                transport: custom(remote as never),
              }),
              mpp,
              parameters,
              store,
            })
          },
          createAccount: async () => ({ accounts: [] }),
          async loadAccounts() {
            return { accounts: [] }
          },
          sendTransaction: async () => {
            throw new Error('unexpected sendTransaction')
          },
          sendTransactionSync: async () => {
            throw new Error('unexpected sendTransactionSync')
          },
          signPersonalMessage: async () => {
            throw new Error('unexpected signPersonalMessage')
          },
          signTransaction: async () => {
            throw new Error('unexpected signTransaction')
          },
          signTypedData: async () => {
            throw new Error('unexpected signTypedData')
          },
        },
      })),
      account: { address: rootAddress },
    })

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'charge',
                method: 'tempo',
                request: {
                  amount: '1',
                  currency: Addresses.pathUsd,
                  methodDetails: { chainId: tempoLocalnet.id },
                  recipient: accounts[1]!.address,
                },
              }),
            ],
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(`[RpcResponse.InternalError: fallback signing]`)
  })

  test('behavior: authorizes with access key before root signer', async () => {
    const provider = createProvider({
      account: { address: rootAddress },
    })
    const account = TempoAccount.fromSecp256k1(privateKeys[2]!, { access: rootAddress })
    const keyAuthorization = KeyAuthorization.from({
      address: account.accessKeyAddress,
      chainId: BigInt(tempoLocalnet.id),
      signature: SignatureEnvelope.from(`0x${'00'.repeat(65)}`),
      type: 'secp256k1',
    })
    AccessKey.add({
      account: rootAddress,
      authorization: keyAuthorization,
      privateKey: privateKeys[2]!,
      store: provider.store,
    })

    const result = await provider.request({
      method: 'mpp_authorize',
      params: [
        {
          challenges: [
            createChallenge({
              intent: 'charge',
              method: 'tempo',
              request: {
                amount: '0',
                currency: Addresses.pathUsd,
                methodDetails: { chainId: tempoLocalnet.id },
                recipient: accounts[1]!.address,
              },
            }),
          ],
        },
      ],
    })

    const credential = Credential.deserialize(result.authorization)
    const payload = credential.payload as { type?: string | undefined }
    expect({
      payloadType: payload.type,
      source: credential.source,
    }).toMatchInlineSnapshot(`
      {
        "payloadType": "proof",
        "source": "did:pkh:eip155:1337:0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
      }
    `)
  })

  test('error: requires a concrete signable account', async () => {
    const provider = createProvider({
      account: { address: rootAddress },
    })

    await expect(
      provider.request({
        method: 'mpp_authorize',
        params: [
          {
            challenges: [
              createChallenge({
                intent: 'charge',
                method: 'tempo',
                request: {
                  amount: '1',
                  currency: Addresses.pathUsd,
                  methodDetails: { chainId: tempoLocalnet.id },
                  recipient: accounts[1]!.address,
                },
              }),
            ],
          },
        ],
      }),
    ).rejects.toThrowErrorMatchingInlineSnapshot(
      `[Provider.UnauthorizedError: Account "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" cannot sign.]`,
    )
  })
})

function createProvider(
  options: { account?: Account.Store | undefined; adapter?: Adapter.Adapter | undefined } = {},
) {
  const provider = Provider.create({
    adapter:
      options.adapter ??
      local({
        loadAccounts: async () => ({ accounts: [] }),
      }),
    mpp: { polyfill: false },
    storage: Storage.memory(),
  })
  provider.store.setState({
    accounts: [options.account ?? { address: rootAddress }],
    activeAccount: 0,
  })
  return provider
}

function createChallenge(options: {
  intent: string
  method: string
  request?: Record<string, unknown> | undefined
}) {
  const { intent, method, request = {} } = options
  return Challenge.serialize(
    Challenge.from({
      id: `${method}-${intent}`,
      intent,
      method,
      realm: 'example.test',
      request,
    }),
  )
}
